import { newId } from './crypto.ts';
import { nowIso, type DB, type Stmt } from './db.ts';

/** Prépare une entrée de journal (à inclure dans un batch pour rester atomique avec l'action). */
export function logStmt(
  db: DB,
  entry: { actor: string | null; action: string; resourceType?: string; resourceId?: string; details?: Record<string, unknown> },
): Stmt {
  return db
    .prepare(
      'INSERT INTO activity_log (id, actor_user_id, action, resource_type, resource_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      newId(),
      entry.actor,
      entry.action,
      entry.resourceType ?? null,
      entry.resourceId ?? null,
      entry.details ? JSON.stringify(entry.details) : null,
      nowIso(),
    );
}

export function notifyStmt(db: DB, userId: string, type: string, payload?: Record<string, unknown>): Stmt {
  return db
    .prepare('INSERT INTO notifications (id, user_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(newId(), userId, type, payload ? JSON.stringify(payload) : null, nowIso());
}
