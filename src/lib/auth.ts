import { newId, sha256Hex } from './crypto.ts';
import { logStmt } from './audit.ts';
import { nowIso, type DB } from './db.ts';
import { normalizeEmail, type Result } from './invitations.ts';
import type { Role } from './permissions.ts';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  picture?: string | null;
}

/**
 * Décide si une personne authentifiée par Google peut entrer. Refus par défaut.
 * Cas autorisés : membre actif ; propriétaire initial (adresse OWNER_EMAIL, tant qu'il n'existe pas) ;
 * invitation valide (jeton + adresse identique + non expirée + non utilisée + non annulée).
 */
export async function authorizeLogin(
  db: DB,
  input: { profile: GoogleProfile; inviteToken?: string | null; ownerEmail: string },
): Promise<Result<{ userId: string; created: boolean }>> {
  const { profile } = input;
  if (!profile.emailVerified) return { ok: false, reason: 'email_not_verified' };
  const email = normalizeEmail(profile.email);
  const now = nowIso();

  const user = await db
    .prepare('SELECT id, google_sub FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; google_sub: string | null }>();

  // L'adresse est déjà associée à un autre compte Google : on refuse (protection contre la réutilisation d'e-mail).
  if (user?.google_sub && user.google_sub !== profile.sub) return { ok: false, reason: 'google_account_mismatch' };

  if (user) {
    const m = await db
      .prepare('SELECT removed_at FROM memberships WHERE user_id = ?')
      .bind(user.id)
      .first<{ removed_at: string | null }>();
    if (m && m.removed_at === null) {
      await db
        .prepare('UPDATE users SET google_sub = ?, name = ?, picture_url = ? WHERE id = ?')
        .bind(profile.sub, profile.name ?? null, profile.picture ?? null, user.id)
        .run();
      return { ok: true, userId: user.id, created: false };
    }
  }

  // Propriétaire initial.
  const ownerExists = await db.prepare('SELECT 1 AS x FROM memberships WHERE is_owner = 1').first();
  if (!ownerExists && email === normalizeEmail(input.ownerEmail)) {
    const userId = user?.id ?? newId();
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO users (id, google_sub, email, name, picture_url, created_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (email) DO UPDATE SET google_sub = excluded.google_sub, name = excluded.name, picture_url = excluded.picture_url`,
          )
          .bind(userId, profile.sub, email, profile.name ?? null, profile.picture ?? null, now),
        db
          .prepare(
            `INSERT INTO memberships (user_id, role, is_owner, joined_at) VALUES (?, 'admin', 1, ?)
             ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_owner = 1, removed_at = NULL`,
          )
          .bind(userId, now),
        logStmt(db, { actor: userId, action: 'owner.initialized', resourceType: 'user', resourceId: userId }),
      ]);
    } catch {
      return { ok: false, reason: 'not_invited' }; // course perdue : un propriétaire existe déjà
    }
    return { ok: true, userId, created: true };
  }

  // Invitation.
  if (!input.inviteToken) return { ok: false, reason: 'not_invited' };
  const invitation = await db
    .prepare('SELECT id, email, role FROM invitations WHERE token_hash = ?')
    .bind(await sha256Hex(input.inviteToken))
    .first<{ id: string; email: string; role: Role }>();
  if (!invitation || normalizeEmail(invitation.email) !== email) return { ok: false, reason: 'not_invited' };

  // Consommation atomique : un seul succès possible, même en cas de requêtes simultanées.
  const claim = await db
    .prepare(
      `UPDATE invitations SET accepted_at = ?
       WHERE id = ? AND accepted_at IS NULL AND cancelled_at IS NULL AND expires_at > ?`,
    )
    .bind(now, invitation.id, now)
    .run();
  if (claim.meta.changes !== 1) return { ok: false, reason: 'invitation_unusable' };

  const userId = user?.id ?? newId();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO users (id, google_sub, email, name, picture_url, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (email) DO UPDATE SET google_sub = excluded.google_sub, name = excluded.name, picture_url = excluded.picture_url`,
        )
        .bind(userId, profile.sub, email, profile.name ?? null, profile.picture ?? null, now),
      db
        .prepare(
          `INSERT INTO memberships (user_id, role, is_owner, joined_at) VALUES (?, ?, 0, ?)
           ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, joined_at = excluded.joined_at, removed_at = NULL`,
        )
        .bind(userId, invitation.role, now),
      logStmt(db, { actor: userId, action: 'invitation.accepted', resourceType: 'invitation', resourceId: invitation.id, details: { role: invitation.role } }),
      db
        .prepare(
          `INSERT INTO notifications (id, user_id, type, payload, created_at)
           SELECT lower(hex(randomblob(16))), user_id, 'invitation.accepted', ?, ? FROM memberships
           WHERE role = 'admin' AND removed_at IS NULL`,
        )
        .bind(JSON.stringify({ email }), now),
    ]);
  } catch {
    // Annule la consommation si la création a échoué, pour ne pas perdre l'invitation.
    await db.prepare('UPDATE invitations SET accepted_at = NULL WHERE id = ?').bind(invitation.id).run();
    return { ok: false, reason: 'internal_error' };
  }
  return { ok: true, userId, created: true };
}
