import { randomToken, sha256Hex } from './crypto.ts';
import { nowIso, type DB } from './db.ts';
import type { Role } from './permissions.ts';

export const SESSION_TTL_DAYS = 7;

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: Role;
  isOwner: boolean;
}

/** Crée une session. Le jeton (cookie) n'est jamais stocké : seul son hachage sert d'identifiant. */
export async function createSession(db: DB, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString();
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, nowIso(), expiresAt)
    .run();
  return { token, expiresAt };
}

/** Retourne l'utilisateur de la session si elle est valide et si le membre n'a pas été retiré. */
export async function getSessionUser(db: DB, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id AS userId, u.email AS email, u.name AS name, u.picture_url AS picture,
              m.role AS role, m.is_owner AS isOwner
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ? AND m.removed_at IS NULL`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<{ userId: string; email: string; name: string | null; picture: string | null; role: Role; isOwner: number }>();
  return row ? { ...row, isOwner: row.isOwner === 1 } : null;
}

export async function revokeSession(db: DB, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
}

export async function revokeUserSessions(db: DB, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
