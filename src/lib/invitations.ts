import { newId, randomToken, sha256Hex } from './crypto.ts';
import { logStmt, notifyStmt } from './audit.ts';
import { nowIso, type DB } from './db.ts';
import { can, type Role } from './permissions.ts';

export const INVITATION_TTL_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: Role[] = ['admin', 'editor', 'reader'];

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Crée une invitation. Le jeton n'est retourné qu'une fois ; seul son hachage est stocké. */
export async function createInvitation(
  db: DB,
  actorId: string,
  input: { email: string; role: Role },
): Promise<Result<{ invitationId: string; token: string; expiresAt: string }>> {
  if (!(await can(db, actorId, 'admin', 'series'))) return { ok: false, reason: 'forbidden' };
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) return { ok: false, reason: 'invalid_email' };
  if (!ROLES.includes(input.role)) return { ok: false, reason: 'invalid_role' };

  const existing = await db
    .prepare(
      `SELECT 1 AS x FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ? AND m.removed_at IS NULL`,
    )
    .bind(email)
    .first();
  if (existing) return { ok: false, reason: 'already_member' };

  const token = randomToken();
  const id = newId();
  const created = nowIso();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString();
  try {
    await db.batch([
      db
        .prepare(
          'INSERT INTO invitations (id, email, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(id, email, input.role, await sha256Hex(token), actorId, created, expiresAt),
      logStmt(db, { actor: actorId, action: 'invitation.created', resourceType: 'invitation', resourceId: id, details: { email, role: input.role } }),
      notifyStmt(db, actorId, 'invitation.sent', { email }),
    ]);
  } catch {
    return { ok: false, reason: 'already_pending' }; // index unique : une seule invitation en attente par adresse
  }
  return { ok: true, invitationId: id, token, expiresAt };
}

export async function cancelInvitation(db: DB, actorId: string, invitationId: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'admin', 'series'))) return { ok: false, reason: 'forbidden' };
  const r = await db
    .prepare('UPDATE invitations SET cancelled_at = ? WHERE id = ? AND accepted_at IS NULL AND cancelled_at IS NULL')
    .bind(nowIso(), invitationId)
    .run();
  if (r.meta.changes === 0) return { ok: false, reason: 'not_pending' };
  await logStmt(db, { actor: actorId, action: 'invitation.cancelled', resourceType: 'invitation', resourceId: invitationId }).run();
  return { ok: true };
}

export async function listPendingInvitations(db: DB, actorId: string) {
  if (!(await can(db, actorId, 'admin', 'series'))) return null;
  const { results } = await db
    .prepare(
      `SELECT id, email, role, created_at, expires_at FROM invitations
       WHERE accepted_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC`,
    )
    .all();
  return results;
}
