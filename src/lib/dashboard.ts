import type { DB } from './db.ts';
import { can, readableIds } from './permissions.ts';
import { listSeasons } from './seasons.ts';
import { listCharacters } from './characters.ts';

export interface DashboardData {
  members: { total: number; admins: number; editors: number; readers: number };
  /** Réservé aux administrateurs (le journal d'activité est une donnée sensible). */
  recentActivity: { id: string; action: string; actorName: string | null; createdAt: string }[] | null;
  /** Derniers documents Drive importés, modifiés récemment, filtrés selon les droits de l'utilisateur. */
  /** Épisodes visibles par l'utilisateur : total et répartition par statut prédéfini. */
  episodes: { total: number; byStatus: Record<'idea' | 'writing' | 'done' | 'validated', number> };
  /** Avancement par saison : part des épisodes « Terminé » ou « Validé ». */
  seasons: { id: string; number: number | null; title: string; total: number; completed: number; finished: boolean }[];
  /** Nombre de personnages visibles par l'utilisateur. */
  characters: number;
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

  const all = await listSeasons(db, userId);
  const eps = [...(all?.seasons.flatMap((x) => x.episodes) ?? []), ...(all?.loose ?? [])];
  const byStatus = { idea: 0, writing: 0, done: 0, validated: 0 };
  for (const e of eps) byStatus[e.status]++;
  const seasons = (all?.seasons ?? []).map((x) => ({
    id: x.id, number: x.number, title: x.title, total: x.episodes.length,
    completed: x.episodes.filter((e) => e.status === 'done' || e.status === 'validated').length, finished: x.finishedAt !== null,
  }));

  const characters = (await listCharacters(db, userId))?.length ?? 0;

  return { characters, episodes: { total: eps.length, byStatus }, seasons, members: counts ?? { total: 0, admins: 0, editors: 0, readers: 0 }, recentActivity, recentDocuments };
}
