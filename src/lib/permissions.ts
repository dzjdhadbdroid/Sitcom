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
 * Filtre une liste de ressources en ne gardant que celles que l'utilisateur peut lire.
 * Même règle que `can()` (exception la plus proche), mais en peu de requêtes : à utiliser pour les listes, la recherche,
 * le tableau de bord et les « éléments liés », afin de ne jamais exposer un élément interdit.
 */
export async function readableIds(db: DB, userId: string, ids: string[]): Promise<Set<string>> {
  const member = await db
    .prepare('SELECT role FROM memberships WHERE user_id = ? AND removed_at IS NULL')
    .bind(userId)
    .first<{ role: Role }>();
  if (!member || ids.length === 0) return new Set();
  const out = new Set<string>();
  if (member.role === 'admin') {
    // Même règle que can() : une ressource inexistante n'est jamais lisible, même pour un administrateur.
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const { results } = await db
        .prepare(`SELECT id FROM resources WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<{ id: string }>();
      for (const { id } of results) out.add(id);
    }
    return out;
  }

  const seen = new Map<string, Level>(); // origine -> niveau de l'exception la plus proche
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `WITH RECURSIVE anc (origin, id, parent_id, depth) AS (
           SELECT id, id, parent_id, 0 FROM resources WHERE id IN (${chunk.map(() => '?').join(',')})
           UNION ALL
           SELECT anc.origin, r.id, r.parent_id, anc.depth + 1 FROM resources r JOIN anc ON r.id = anc.parent_id
           WHERE anc.depth < 20
         )
         SELECT anc.origin AS origin, g.level AS level FROM anc
         JOIN grants g ON g.resource_id = anc.id AND g.user_id = ?
         ORDER BY anc.origin, anc.depth`,
      )
      .bind(...chunk, userId)
      .all<{ origin: string; level: Level }>();
    for (const row of results) if (!seen.has(row.origin)) seen.set(row.origin, row.level);
    const { results: known } = await db
      .prepare(`SELECT id FROM resources WHERE id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all<{ id: string }>();
    for (const { id } of known) {
      const level = seen.get(id) ?? roleDefault(member.role);
      if (allows(member.role, level, 'read')) out.add(id);
    }
  }
  return out;
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
