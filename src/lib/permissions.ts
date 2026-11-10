import type { DB } from './db.ts';

export type Role = 'admin' | 'editor' | 'reader';
export type Level = 'none' | 'read' | 'write';
export type Action = 'read' | 'write' | 'admin';

const RANK: Record<Level, number> = { none: 0, read: 1, write: 2 };

/** Niveau par défaut d'un rôle, avant exceptions. */
export function roleDefault(role: Role): Level {
  return role === 'reader' ? 'read' : 'write';
}

/**
 * Calcule le niveau effectif.
 * `path` va de la ressource vers la racine ; l'exception la plus proche de la ressource l'emporte.
 * Un administrateur est toujours en écriture : aucune exception ne peut le restreindre.
 */
export function resolveLevel(role: Role, path: { id: string; level: Level | null }[]): Level {
  if (role === 'admin') return 'write';
  for (const node of path) if (node.level !== null) return node.level;
  return roleDefault(role);
}

export function allows(role: Role, level: Level, action: Action): boolean {
  if (action === 'admin') return role === 'admin';
  return RANK[level] >= RANK[action];
}

/**
 * Contrôle d'accès unique, appelé côté serveur pour toute opération protégée.
 * Refuse par défaut : utilisateur inconnu, retiré, ressource inexistante.
 */
export async function can(db: DB, userId: string, action: Action, resourceId: string): Promise<boolean> {
  const member = await db
    .prepare('SELECT role FROM memberships WHERE user_id = ? AND removed_at IS NULL')
    .bind(userId)
    .first<{ role: Role }>();
  if (!member) return false;

  if (action === 'admin') return member.role === 'admin';

  const { results } = await db
    .prepare(
      `WITH RECURSIVE anc (id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM resources WHERE id = ?
         UNION ALL
         SELECT r.id, r.parent_id, anc.depth + 1 FROM resources r JOIN anc ON r.id = anc.parent_id
         WHERE anc.depth < 20
       )
       SELECT anc.id AS id, g.level AS level
       FROM anc LEFT JOIN grants g ON g.resource_id = anc.id AND g.user_id = ?
       ORDER BY anc.depth`,
    )
    .bind(resourceId, userId)
    .all<{ id: string; level: Level | null }>();

  if (results.length === 0) return false; // ressource inconnue
  return allows(member.role, resolveLevel(member.role, results), action);
}
