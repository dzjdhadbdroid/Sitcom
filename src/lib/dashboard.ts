import type { DB } from './db.ts';
import { can } from './permissions.ts';

export interface DashboardData {
  members: { total: number; admins: number; editors: number; readers: number };
  /** Réservé aux administrateurs (le journal d'activité est une donnée sensible). */
  recentActivity: { id: string; action: string; actorName: string | null; createdAt: string }[] | null;
}

/**
 * Tableau de bord : uniquement des données réelles. Les indicateurs des saisons, épisodes, personnages, idées
 * et documents seront ajoutés avec leurs rubriques (phases 5 à 9) ; aucune valeur fictive n'est produite.
 */
export async function getDashboard(db: DB, userId: string): Promise<DashboardData | null> {
  if (!(await can(db, userId, 'read', 'series'))) return null;

  const counts = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(role = 'admin'), 0) AS admins,
              COALESCE(SUM(role = 'editor'), 0) AS editors,
              COALESCE(SUM(role = 'reader'), 0) AS readers
       FROM memberships WHERE removed_at IS NULL`,
    )
    .first<DashboardData['members']>();

  let recentActivity: DashboardData['recentActivity'] = null;
  if (await can(db, userId, 'admin', 'series')) {
    const { results } = await db
      .prepare(
        `SELECT a.id AS id, a.action AS action, COALESCE(u.name, u.email) AS actorName, a.created_at AS createdAt
         FROM activity_log a LEFT JOIN users u ON u.id = a.actor_user_id
         ORDER BY a.created_at DESC, a.rowid DESC LIMIT 10`,
      )
      .all<{ id: string; action: string; actorName: string | null; createdAt: string }>();
    recentActivity = results;
  }

  return { members: counts ?? { total: 0, admins: 0, editors: 0, readers: 0 }, recentActivity };
}
