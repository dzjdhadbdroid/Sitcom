import { decryptText, encryptText } from './crypto.ts';
import { logStmt, notifyStmt } from './audit.ts';
import { nowIso, type DB } from './db.ts';
import { DriveClient, DriveError, refreshAccessToken, revokeToken, type FetchLike, type OAuthConfig } from './drive.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface DriveSecrets extends OAuthConfig { encryptionKey: string }

export interface ConnectionInfo {
  status: 'active' | 'reauth_required';
  lastSyncAt: string | null;
  lastError: string | null;
  connectedAt: string;
}

export async function getConnectionInfo(db: DB, userId: string): Promise<ConnectionInfo | null> {
  return db
    .prepare('SELECT status, last_sync_at AS lastSyncAt, last_error AS lastError, connected_at AS connectedAt FROM drive_connections WHERE user_id = ?')
    .bind(userId)
    .first<ConnectionInfo>();
}

/** Enregistre (ou remplace) la connexion Drive. Le jeton est chiffré avant d'être écrit ; il n'apparaît jamais en clair. */
export async function saveConnection(db: DB, userId: string, refreshToken: string, scope: string, keyB64: string): Promise<void> {
  const enc = await encryptText(refreshToken, keyB64);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO drive_connections (user_id, refresh_token_enc, scope, status, page_token, last_error, connected_at)
         VALUES (?, ?, ?, 'active', NULL, NULL, ?)
         ON CONFLICT (user_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, scope = excluded.scope,
           status = 'active', last_error = NULL, connected_at = excluded.connected_at`,
      )
      .bind(userId, enc, scope, now),
    logStmt(db, { actor: userId, action: 'drive.connected', resourceType: 'user', resourceId: userId }),
  ]);
}

/**
 * Déconnexion : supprime le jeton et révoque l'autorisation chez Google.
 * Les références de documents et leur classement sont CONSERVÉS (aucune perte de données).
 */
export async function disconnect(db: DB, userId: string, keyB64: string, fetcher?: FetchLike): Promise<boolean> {
  const row = await db.prepare('SELECT refresh_token_enc FROM drive_connections WHERE user_id = ?').bind(userId).first<{ refresh_token_enc: string }>();
  if (!row) return false;
  try {
    await revokeToken(await decryptText(row.refresh_token_enc, keyB64), fetcher);
  } catch {
    /* jeton illisible : on supprime quand même la connexion locale */
  }
  await db.batch([
    db.prepare('DELETE FROM drive_sync_folders WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM drive_connections WHERE user_id = ?').bind(userId),
    logStmt(db, { actor: userId, action: 'drive.disconnected', resourceType: 'user', resourceId: userId }),
  ]);
  return true;
}

/** Marque la connexion comme nécessitant une reconnexion et prévient l'utilisateur une seule fois. */
export async function markReauthRequired(db: DB, userId: string): Promise<void> {
  const r = await db.prepare("UPDATE drive_connections SET status = 'reauth_required', last_error = 'auth_revoked' WHERE user_id = ? AND status != 'reauth_required'").bind(userId).run();
  if (r.meta.changes === 0) return;
  await db.batch([
    notifyStmt(db, userId, 'drive.reauth_required'),
    logStmt(db, { actor: null, action: 'drive.reauth_required', resourceType: 'user', resourceId: userId }),
  ]);
}

/** Retourne un client Drive prêt à l'emploi pour cet utilisateur, ou lève DriveError (auth_revoked si non connecté). */
export async function clientFor(db: DB, userId: string, secrets: DriveSecrets, fetcher?: FetchLike): Promise<DriveClient> {
  const row = await db
    .prepare('SELECT refresh_token_enc, status FROM drive_connections WHERE user_id = ?')
    .bind(userId)
    .first<{ refresh_token_enc: string; status: string }>();
  if (!row || row.status !== 'active') throw new DriveError('auth_revoked');
  let refresh: string;
  try {
    refresh = await decryptText(row.refresh_token_enc, secrets.encryptionKey);
  } catch {
    throw new DriveError('unknown', 'jeton illisible'); // clé de chiffrement changée : ne PAS marquer comme révoqué
  }
  try {
    const access = await refreshAccessToken(refresh, secrets, fetcher);
    return new DriveClient(access, fetcher);
  } catch (e) {
    if (e instanceof DriveError && e.kind === 'auth_revoked') await markReauthRequired(db, userId);
    throw e;
  }
}
