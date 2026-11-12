import { newId } from './crypto.ts';
import { logStmt } from './audit.ts';
import { nowIso, type DB, type Stmt } from './db.ts';
import type { Result } from './invitations.ts';
import { can, readableIds } from './permissions.ts';

export const EPISODE_KINDS = ['regular', 'pilot', 'special', 'bonus', 'cut_scene'] as const;
export const EPISODE_STATUSES = ['idea', 'writing', 'done', 'validated'] as const; // prédéfinis, non personnalisables
export type EpisodeKind = (typeof EPISODE_KINDS)[number];
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

const SEASONS = 'section:seasons';
const MAX_EPISODES_AT_CREATION = 60;
const pad = (n: number) => String(n).padStart(2, '0');

/** Numéro de référence affiché (S01E03, S01SP01, HSBN01…). Purement cosmétique : l'identité reste l'identifiant interne. */
export function episodeCode(kind: EpisodeKind, seasonNumber: number | null, hasSeason: boolean, number: number | null): string {
  const season = hasSeason ? (seasonNumber != null ? `S${pad(seasonNumber)}` : 'S??') : 'HS';
  const type = { regular: 'E', pilot: 'E', special: 'SP', bonus: 'BN', cut_scene: 'CS' }[kind];
  return `${season}${number != null ? `${type}${pad(number)}` : ''}`;
}

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length <= max ? (t === '' ? null : t) : undefined;
};
const int = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null || v === '' || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

// ---------- Lecture ----------

export interface EpisodeRow {
  id: string; seasonId: string | null; kind: EpisodeKind; number: number | null; code: string; title: string; summary: string | null;
  status: EpisodeStatus; durationMin: number | null; position: number; documentCount: number; hasMainScript: boolean;
}
export interface SeasonRow {
  id: string; number: number | null; title: string; summary: string | null; position: number; finishedAt: string | null; episodes: EpisodeRow[];
}

const EP_SQL = `SELECT e.id AS id, e.season_id AS seasonId, e.kind AS kind, e.number AS number, e.title AS title, e.summary AS summary,
    e.status AS status, e.duration_min AS durationMin, e.position AS position, s.number AS seasonNumber,
    (SELECT COUNT(*) FROM episode_documents d WHERE d.episode_id = e.id) AS documentCount,
    EXISTS (SELECT 1 FROM episode_documents d WHERE d.episode_id = e.id AND d.is_main = 1) AS hasMainScript
  FROM episodes e JOIN resources r ON r.id = e.id AND r.archived_at IS NULL LEFT JOIN seasons s ON s.id = e.season_id`;

type RawEp = Omit<EpisodeRow, 'code' | 'hasMainScript'> & { seasonNumber: number | null; hasMainScript: number };
const toEpisode = (r: RawEp): EpisodeRow => {
  const { seasonNumber, hasMainScript, ...rest } = r;
  return { ...rest, hasMainScript: !!hasMainScript, code: episodeCode(r.kind, seasonNumber, r.seasonId !== null, r.number) };
};

/** Saisons et épisodes (hors archives) que l'utilisateur a le droit de voir. Les épisodes « hors saison » sont retournés à part. */
export async function listSeasons(db: DB, userId: string): Promise<{ seasons: SeasonRow[]; loose: EpisodeRow[] } | null> {
  if (!(await can(db, userId, 'read', SEASONS))) return null;
  const { results: seasons } = await db
    .prepare(
      `SELECT s.id AS id, s.number AS number, s.title AS title, s.summary AS summary, s.position AS position, s.finished_at AS finishedAt
       FROM seasons s JOIN resources r ON r.id = s.id AND r.archived_at IS NULL ORDER BY s.position, s.created_at`,
    )
    .all<Omit<SeasonRow, 'episodes'>>();
  const { results: eps } = await db.prepare(`${EP_SQL} ORDER BY e.position, e.created_at`).all<RawEp>();
  const ok = await readableIds(db, userId, [...seasons.map((s) => s.id), ...eps.map((e) => e.id)]);
  const visible = eps.filter((e) => ok.has(e.id)).map(toEpisode);
  return {
    seasons: seasons.filter((s) => ok.has(s.id)).map((s) => ({ ...s, episodes: visible.filter((e) => e.seasonId === s.id) })),
    loose: visible.filter((e) => e.seasonId === null),
  };
}

export interface EpisodeDoc {
  id: string; title: string; category: string | null; status: string; statusDetail: string | null; isMain: boolean; viewable: boolean; modifiedTime: string | null;
}
export interface EpisodeDetail extends EpisodeRow { seasonTitle: string | null; seasonNumber: number | null; documents: EpisodeDoc[]; canWrite: boolean }

export async function getEpisode(db: DB, userId: string, id: string): Promise<EpisodeDetail | null> {
  if (!(await can(db, userId, 'read', id))) return null;
  const row = await db.prepare(`${EP_SQL} WHERE e.id = ?`).bind(id).first<RawEp & { seasonNumber: number | null }>();
  if (!row) return null;
  const season = row.seasonId ? await db.prepare('SELECT title, number FROM seasons WHERE id = ?').bind(row.seasonId).first<{ title: string; number: number | null }>() : null;
  const { results } = await db
    .prepare(
      `SELECT d.id AS id, d.title AS title, d.category AS category, d.status AS status, d.status_detail AS statusDetail, l.is_main AS isMain,
              d.mime_type AS mimeType, d.modified_time AS modifiedTime
       FROM episode_documents l JOIN drive_documents d ON d.id = l.document_id WHERE l.episode_id = ? ORDER BY l.is_main DESC, d.title`,
    )
    .bind(id)
    .all<{ id: string; title: string; category: string | null; status: string; statusDetail: string | null; isMain: number; mimeType: string; modifiedTime: string | null }>();
  // Un document auquel l'utilisateur n'a pas accès n'apparaît pas dans la fiche.
  const ok = await readableIds(db, userId, results.map((r) => r.id));
  const documents = results.filter((r) => ok.has(r.id)).map(({ mimeType, isMain, ...r }) => ({ ...r, isMain: !!isMain, viewable: mimeType === 'application/vnd.google-apps.document' }));
  const base = toEpisode(row);
  return { ...base, documentCount: documents.length, hasMainScript: documents.some((d) => d.isMain), seasonTitle: season?.title ?? null, seasonNumber: season?.number ?? null, documents, canWrite: await can(db, userId, 'write', id) };
}

// ---------- Saisons ----------

export interface SeasonInput { title?: unknown; number?: unknown; summary?: unknown; episodeCount?: unknown }

export async function createSeason(db: DB, actorId: string, input: SeasonInput): Promise<Result<{ id: string; episodeIds: string[] }>> {
  if (!(await can(db, actorId, 'write', SEASONS))) return { ok: false, reason: 'forbidden' };
  const title = text(input.title ?? '', 200);
  const summary = text(input.summary, 5000);
  let number = int(input.number, 0, 99);
  const count = int(input.episodeCount ?? 0, 0, MAX_EPISODES_AT_CREATION) ?? 0;
  if (title === undefined) return { ok: false, reason: 'invalid_title' };
  if (summary === undefined) return { ok: false, reason: 'invalid_summary' };
  if (number === undefined) return { ok: false, reason: 'invalid_number' };
  if (int(input.episodeCount ?? 0, 0, MAX_EPISODES_AT_CREATION) === undefined) return { ok: false, reason: 'invalid_episode_count' };

  if (number === null) {
    const m = await db.prepare('SELECT MAX(s.number) AS n FROM seasons s JOIN resources r ON r.id = s.id AND r.archived_at IS NULL').first<{ n: number | null }>();
    number = (m?.n ?? 0) + 1;
  }
  const pos = await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM seasons').first<{ p: number }>();
  const id = newId();
  const now = nowIso();
  const stmts: Stmt[] = [
    db.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'season', ?)").bind(id, SEASONS),
    db.prepare('INSERT INTO seasons (id, number, title, summary, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, number, title ?? '', summary, pos?.p ?? 1, now, now),
  ];
  const episodeIds: string[] = [];
  // Emplacements générés automatiquement : numérotés, sans titre, au statut « Idée ».
  for (let i = 1; i <= count; i++) {
    const eid = newId();
    episodeIds.push(eid);
    stmts.push(
      db.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'episode', ?)").bind(eid, id),
      db.prepare("INSERT INTO episodes (id, season_id, kind, number, title, status, position, created_at, updated_at) VALUES (?, ?, 'regular', ?, '', 'idea', ?, ?, ?)").bind(eid, id, i, i, now, now),
    );
  }
  stmts.push(logStmt(db, { actor: actorId, action: 'season.created', resourceType: 'season', resourceId: id, details: { episodes: count } }));
  await db.batch(stmts);
  return { ok: true, id, episodeIds };
}

export async function updateSeason(db: DB, actorId: string, id: string, patch: { title?: unknown; number?: unknown; summary?: unknown; finished?: unknown }): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const cur = await db.prepare('SELECT 1 AS x FROM seasons s JOIN resources r ON r.id = s.id AND r.archived_at IS NULL WHERE s.id = ?').bind(id).first();
  if (!cur) return { ok: false, reason: 'not_found' };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('title' in patch) { const v = text(patch.title ?? '', 200); if (v === undefined) return { ok: false, reason: 'invalid_title' }; sets.push('title = ?'); vals.push(v ?? ''); }
  if ('number' in patch) { const v = int(patch.number, 0, 99); if (v === undefined) return { ok: false, reason: 'invalid_number' }; sets.push('number = ?'); vals.push(v); }
  if ('summary' in patch) { const v = text(patch.summary, 5000); if (v === undefined) return { ok: false, reason: 'invalid_summary' }; sets.push('summary = ?'); vals.push(v); }
  if ('finished' in patch) {
    if (typeof patch.finished !== 'boolean') return { ok: false, reason: 'invalid_finished' };
    sets.push('finished_at = ?'); vals.push(patch.finished ? nowIso() : null); // marquage purement manuel
  }
  if (sets.length === 0) return { ok: false, reason: 'nothing_to_update' };
  const now = nowIso();
  await db.batch([
    db.prepare(`UPDATE seasons SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, now, id),
    logStmt(db, { actor: actorId, action: 'season.updated', resourceType: 'season', resourceId: id }),
  ]);
  return { ok: true };
}

// ---------- Réorganisation ----------

/**
 * Réordonne un sous-ensemble de frères : les éléments donnés se répartissent, dans le nouvel ordre, les positions qu'ils occupaient.
 * Les éléments que l'utilisateur ne voit pas gardent leur place ; aucun document n'est touché.
 */
async function applyOrder(db: DB, table: 'seasons' | 'episodes', ids: string[], actorId: string, action: string, parent: string): Promise<Result<object>> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || new Set(ids).size !== ids.length || ids.some((i) => typeof i !== 'string')) return { ok: false, reason: 'invalid_order' };
  const rows: { id: string; position: number }[] = [];
  for (const id of ids) {
    const r = await db.prepare(`SELECT t.id AS id, t.position AS position FROM ${table} t JOIN resources x ON x.id = t.id AND x.archived_at IS NULL WHERE t.id = ?${table === 'episodes' ? ' AND COALESCE(t.season_id, \'\') = ?' : ''}`).bind(...(table === 'episodes' ? [id, parent === SEASONS ? '' : parent] : [id])).first<{ id: string; position: number }>();
    if (!r) return { ok: false, reason: 'invalid_order' };
    if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
    rows.push(r);
  }
  const slots = rows.map((r) => r.position).sort((a, b) => a - b);
  const now = nowIso();
  await db.batch([
    ...ids.map((id, i) => db.prepare(`UPDATE ${table} SET position = ?, updated_at = ? WHERE id = ?`).bind(slots[i], now, id)),
    logStmt(db, { actor: actorId, action, resourceType: table === 'seasons' ? 'season' : 'episode', resourceId: parent }),
  ]);
  return { ok: true };
}

export async function reorderSeasons(db: DB, actorId: string, ids: string[]): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', SEASONS))) return { ok: false, reason: 'forbidden' };
  return applyOrder(db, 'seasons', ids, actorId, 'season.reordered', SEASONS);
}

/** `seasonId` null = épisodes hors saison. */
export async function reorderEpisodes(db: DB, actorId: string, seasonId: string | null, ids: string[]): Promise<Result<object>> {
  const parent = seasonId ?? SEASONS;
  if (!(await can(db, actorId, 'write', parent))) return { ok: false, reason: 'forbidden' };
  return applyOrder(db, 'episodes', ids, actorId, 'episode.reordered', parent);
}

// ---------- Épisodes ----------

export interface EpisodeInput { seasonId?: unknown; title?: unknown; kind?: unknown; number?: unknown; summary?: unknown; status?: unknown; durationMin?: unknown }

async function seasonParent(db: DB, seasonId: unknown): Promise<string | null | undefined> {
  if (seasonId === null || seasonId === undefined || seasonId === '') return SEASONS; // hors saison
  if (typeof seasonId !== 'string') return undefined;
  const r = await db.prepare('SELECT 1 AS x FROM seasons s JOIN resources r ON r.id = s.id AND r.archived_at IS NULL WHERE s.id = ?').bind(seasonId).first();
  return r ? seasonId : undefined;
}

export async function createEpisode(db: DB, actorId: string, input: EpisodeInput): Promise<Result<{ id: string }>> {
  const parent = await seasonParent(db, input.seasonId);
  if (parent === undefined) return { ok: false, reason: 'season_not_found' };
  if (!(await can(db, actorId, 'write', parent))) return { ok: false, reason: 'forbidden' };
  const title = text(input.title ?? '', 200);
  const summary = text(input.summary, 5000);
  const kind = (input.kind ?? 'regular') as EpisodeKind;
  const status = (input.status ?? 'idea') as EpisodeStatus;
  let number = int(input.number, 0, 999);
  const duration = int(input.durationMin, 1, 600);
  if (title === undefined) return { ok: false, reason: 'invalid_title' };
  if (summary === undefined) return { ok: false, reason: 'invalid_summary' };
  if (!EPISODE_KINDS.includes(kind)) return { ok: false, reason: 'invalid_kind' };
  if (!EPISODE_STATUSES.includes(status)) return { ok: false, reason: 'invalid_status' };
  if (number === undefined) return { ok: false, reason: 'invalid_number' };
  if (duration === undefined) return { ok: false, reason: 'invalid_duration' };
  const seasonId = parent === SEASONS ? null : parent;
  if (number === null && (input.number === undefined || input.number === '')) {
    const m = await db.prepare("SELECT MAX(e.number) AS n FROM episodes e JOIN resources r ON r.id = e.id AND r.archived_at IS NULL WHERE COALESCE(e.season_id, '') = ? AND e.kind = ?").bind(seasonId ?? '', kind).first<{ n: number | null }>();
    number = (m?.n ?? 0) + 1;
  }
  const pos = await db.prepare("SELECT COALESCE(MAX(e.position), 0) + 1 AS p FROM episodes e WHERE COALESCE(e.season_id, '') = ?").bind(seasonId ?? '').first<{ p: number }>();
  const id = newId();
  const now = nowIso();
  await db.batch([
    db.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'episode', ?)").bind(id, parent),
    db.prepare('INSERT INTO episodes (id, season_id, kind, number, title, summary, status, duration_min, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, seasonId, kind, number, title ?? '', summary, status, duration, pos?.p ?? 1, now, now),
    logStmt(db, { actor: actorId, action: 'episode.created', resourceType: 'episode', resourceId: id }),
  ]);
  return { ok: true, id };
}

/** Modifie un épisode. Changer son numéro, son titre ou sa saison ne touche jamais à ses documents (liés par identifiant interne). */
export async function updateEpisode(db: DB, actorId: string, id: string, patch: EpisodeInput): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const cur = await db.prepare('SELECT e.season_id AS seasonId FROM episodes e JOIN resources r ON r.id = e.id AND r.archived_at IS NULL WHERE e.id = ?').bind(id).first<{ seasonId: string | null }>();
  if (!cur) return { ok: false, reason: 'not_found' };
  const sets: string[] = [];
  const vals: unknown[] = [];
  const stmts: Stmt[] = [];
  if ('title' in patch) { const v = text(patch.title ?? '', 200); if (v === undefined) return { ok: false, reason: 'invalid_title' }; sets.push('title = ?'); vals.push(v ?? ''); }
  if ('summary' in patch) { const v = text(patch.summary, 5000); if (v === undefined) return { ok: false, reason: 'invalid_summary' }; sets.push('summary = ?'); vals.push(v); }
  if ('number' in patch) { const v = int(patch.number, 0, 999); if (v === undefined) return { ok: false, reason: 'invalid_number' }; sets.push('number = ?'); vals.push(v); }
  if ('durationMin' in patch) { const v = int(patch.durationMin, 1, 600); if (v === undefined) return { ok: false, reason: 'invalid_duration' }; sets.push('duration_min = ?'); vals.push(v); }
  if ('kind' in patch) { if (!EPISODE_KINDS.includes(patch.kind as EpisodeKind)) return { ok: false, reason: 'invalid_kind' }; sets.push('kind = ?'); vals.push(patch.kind); }
  if ('status' in patch) { if (!EPISODE_STATUSES.includes(patch.status as EpisodeStatus)) return { ok: false, reason: 'invalid_status' }; sets.push('status = ?'); vals.push(patch.status); }
  if ('seasonId' in patch) {
    const parent = await seasonParent(db, patch.seasonId);
    if (parent === undefined) return { ok: false, reason: 'season_not_found' };
    const target = parent === SEASONS ? null : parent;
    if (target !== cur.seasonId) {
      if (!(await can(db, actorId, 'write', parent))) return { ok: false, reason: 'forbidden' }; // déplacer exige aussi le droit sur la destination
      const pos = await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM episodes WHERE COALESCE(season_id, '') = ?").bind(target ?? '').first<{ p: number }>();
      sets.push('season_id = ?', 'position = ?'); vals.push(target, pos?.p ?? 1);
      stmts.push(db.prepare('UPDATE resources SET parent_id = ? WHERE id = ?').bind(parent, id));
    }
  }
  if (sets.length === 0) return { ok: false, reason: 'nothing_to_update' };
  await db.batch([
    db.prepare(`UPDATE episodes SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...vals, nowIso(), id),
    ...stmts,
    logStmt(db, { actor: actorId, action: 'episode.updated', resourceType: 'episode', resourceId: id }),
  ]);
  return { ok: true };
}

/** Archivage (jamais de suppression définitive). Les documents liés et le fichier Drive ne sont pas touchés. */
export async function archive(db: DB, actorId: string, id: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const r = await db.prepare("SELECT type FROM resources WHERE id = ? AND type IN ('season', 'episode') AND archived_at IS NULL").bind(id).first<{ type: string }>();
  if (!r) return { ok: false, reason: 'not_found' };
  const now = nowIso();
  const stmts: Stmt[] = [db.prepare('UPDATE resources SET archived_at = ? WHERE id = ?').bind(now, id)];
  if (r.type === 'season') stmts.push(db.prepare("UPDATE resources SET archived_at = ? WHERE parent_id = ? AND type = 'episode' AND archived_at IS NULL").bind(now, id));
  stmts.push(logStmt(db, { actor: actorId, action: `${r.type}.archived`, resourceType: r.type, resourceId: id }));
  await db.batch(stmts);
  return { ok: true };
}

// ---------- Documents associés ----------

/** Rattache un document déjà importé à un épisode. Exige l'écriture sur l'épisode ET la lecture du document. */
export async function linkDocument(db: DB, actorId: string, episodeId: string, docId: string, main = false): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', episodeId)) || !(await can(db, actorId, 'read', docId))) return { ok: false, reason: 'forbidden' };
  const ep = await db.prepare('SELECT 1 AS x FROM episodes e JOIN resources r ON r.id = e.id AND r.archived_at IS NULL WHERE e.id = ?').bind(episodeId).first();
  const doc = await db.prepare("SELECT 1 AS x FROM drive_documents WHERE id = ? AND state = 'imported'").bind(docId).first();
  if (!ep || !doc) return { ok: false, reason: 'not_found' };
  const stmts: Stmt[] = [];
  if (main) stmts.push(db.prepare('UPDATE episode_documents SET is_main = 0 WHERE episode_id = ?').bind(episodeId));
  stmts.push(
    db.prepare('INSERT INTO episode_documents (episode_id, document_id, is_main, linked_by, linked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (episode_id, document_id) DO UPDATE SET is_main = excluded.is_main WHERE ? = 1')
      .bind(episodeId, docId, main ? 1 : 0, actorId, nowIso(), main ? 1 : 0),
    logStmt(db, { actor: actorId, action: 'episode.document_linked', resourceType: 'episode', resourceId: episodeId, details: { document: docId, main } }),
  );
  await db.batch(stmts);
  return { ok: true };
}

/** Désigne (ou retire) le scénario principal parmi les documents déjà rattachés. */
export async function setMainDocument(db: DB, actorId: string, episodeId: string, docId: string | null): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', episodeId))) return { ok: false, reason: 'forbidden' };
  if (docId !== null) {
    const l = await db.prepare('SELECT 1 AS x FROM episode_documents WHERE episode_id = ? AND document_id = ?').bind(episodeId, docId).first();
    if (!l) return { ok: false, reason: 'not_found' };
  }
  await db.batch([
    db.prepare('UPDATE episode_documents SET is_main = 0 WHERE episode_id = ?').bind(episodeId),
    ...(docId ? [db.prepare('UPDATE episode_documents SET is_main = 1 WHERE episode_id = ? AND document_id = ?').bind(episodeId, docId)] : []),
    logStmt(db, { actor: actorId, action: 'episode.main_script_changed', resourceType: 'episode', resourceId: episodeId, details: { document: docId } }),
  ]);
  return { ok: true };
}

/** Détache un document (le lien seulement : ni le fichier Drive, ni la référence importée ne sont touchés). */
export async function unlinkDocument(db: DB, actorId: string, episodeId: string, docId: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', episodeId))) return { ok: false, reason: 'forbidden' };
  const r = await db.prepare('DELETE FROM episode_documents WHERE episode_id = ? AND document_id = ?').bind(episodeId, docId).run();
  if (r.meta.changes === 0) return { ok: false, reason: 'not_found' };
  await db.batch([logStmt(db, { actor: actorId, action: 'episode.document_unlinked', resourceType: 'episode', resourceId: episodeId, details: { document: docId } })]);
  return { ok: true };
}
