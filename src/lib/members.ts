import { newId } from './crypto.ts';
import { logStmt } from './audit.ts';
import { nowIso, type DB } from './db.ts';
import type { Result } from './invitations.ts';
import { can, type Level, type Role } from './permissions.ts';

const ROLES: Role[] = ['admin', 'editor', 'reader'];

async function targetOf(db: DB, userId: string) {
  return db
    .prepare('SELECT user_id, role, is_owner FROM memberships WHERE user_id = ? AND removed_at IS NULL')
    .bind(userId)
    .first<{ user_id: string; role: Role; is_owner: number }>();
}

/** Change le rôle d'un membre. Le propriétaire ne peut jamais être modifié. */
export async function setRole(db: DB, actorId: string, targetId: string, role: Role): Promise<Result<object>> {
  if (!(await can(db, actorId, 'admin', 'series'))) return { ok: false, reason: 'forbidden' };
  if (!ROLES.includes(role)) return { ok: false, reason: 'invalid_role' };
  const target = await targetOf(db, targetId);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.is_owner === 1) return { ok: false, reason: 'owner_protected' };
  await db.batch([
    db.prepare('UPDATE memberships SET role = ? WHERE user_id = ?').bind(role, targetId),
    logStmt(db, { actor: actorId, action: 'member.role_changed', resourceType: 'user', resourceId: targetId, details: { from: target.role, to: role } }),
  ]);
  return { ok: true };
}

/** Retire un membre (désactivation, pas de suppression) et révoque ses sessions. */
export async function removeMember(db: DB, actorId: string, targetId: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'admin', 'series'))) return { ok: false, reason: 'forbidden' };
  const target = await targetOf(db, targetId);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.is_owner === 1) return { ok: false, reason: 'owner_protected' };
  if (targetId === actorId) return { ok: false, reason: 'cannot_remove_self' };
  await db.batch([
    db.prepare('UPDATE memberships SET removed_at = ? WHERE user_id = ?').bind(nowIso(), targetId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId),
    logStmt(db, { actor: actorId, action: 'member.removed', resourceType: 'user', resourceId: targetId }),
  ]);
  return { ok: true };
}

/** Définit (ou supprime avec level = null) une exception de permission sur une ressource. */
export async function setGrant(
  db: DB,
  actorId: string,
  targetId: string,
  resourceId: string,
  level: Level | null,
): Promise<Result<object>> {
  if (!(await can(db, actorId, 'admin', 'series'))) return { ok: false, reason: 'forbidden' };
  const target = await targetOf(db, targetId);
  if (!target) return { ok: false, reason: 'not_found' };
  if (target.role === 'admin') return { ok: false, reason: 'admin_not_restrictable' };
  const resource = await db.prepare('SELECT 1 AS x FROM resources WHERE id = ?').bind(resourceId).first();
  if (!resource) return { ok: false, reason: 'resource_not_found' };

  const log = logStmt(db, {
    actor: actorId,
    action: 'permission.changed',
    resourceType: 'user',
    resourceId: targetId,
    details: { resource: resourceId, level },
  });
  if (level === null) {
    await db.batch([
      db.prepare('DELETE FROM grants WHERE user_id = ? AND resource_id = ?').bind(targetId, resourceId),
      log,
    ]);
  } else {
    if (!['none', 'read', 'write'].includes(level)) return { ok: false, reason: 'invalid_level' };
    await db.batch([
      db
        .prepare(
          `INSERT INTO grants (id, user_id, resource_id, level, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, resource_id) DO UPDATE SET level = excluded.level`,
        )
        .bind(newId(), targetId, resourceId, level, actorId, nowIso()),
      log,
    ]);
  }
  return { ok: true };
}
