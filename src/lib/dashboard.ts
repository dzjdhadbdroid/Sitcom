import type { DB } from './db.ts';
import { can, readableIds } from './permissions.ts';

export interface DashboardData {
  members: { total: number; admins: number; editors: number; readers: number };
  /** Réservé aux administrateurs (le journal d'activité est une donnée sensible). */
  recentActivity: { id: string; action: string; actorName: string | null; createdAt: string }[] | null;
  /** Derniers documents Drive importés, modifiés récemment, filtrés selon les droits de l'utilisateur. */
  recentDocuments: { id: string; title: string; category: string | null; modifiedTime: string | null; status: string }[];
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

  const { results: docs } = await db
    .prepare(
      `SELECT id, title, category, modified_time AS modifiedTime, status FROM drive_documents
       WHERE state = 'imported' ORDER BY COALESCE(modified_time, last_seen_at) DESC LIMIT 60`,
    )
    .all<{ id: string; title: string; category: string | null; modifiedTime: string | null; status: string }>();
  const ok = await readableIds(db, userId, docs.map((d) => d.id));
  const recentDocuments = docs.filter((d) => ok.has(d.id)).slice(0, 5);

  return { members: counts ?? { total: 0, admins: 0, editors: 0, readers: 0 }, recentActivity, recentDocuments };
}
