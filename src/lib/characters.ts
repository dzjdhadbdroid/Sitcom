import { newId } from './crypto.ts';
import { logStmt } from './audit.ts';
import { nowIso, type DB, type Stmt } from './db.ts';
import { storeImage } from './images.ts';
import type { Result } from './invitations.ts';
import { can, readableIds } from './permissions.ts';
import { episodeCode, type EpisodeKind } from './seasons.ts';

const SECTION = 'section:characters';
export const RELATION_KINDS = ['family', 'friendship', 'couple', 'colleagues', 'rivalry', 'other'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

const TEXT_FIELDS = { physical: 'physical', personality: 'personality', history: 'history', qualities: 'qualities', flaws: 'flaws', particularities: 'particularities' } as const;

const text = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length <= max ? (t === '' ? null : t) : undefined;
};

export const displayName = (c: { firstName: string; lastName: string }) => [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Sans nom';

export interface CharacterCard { id: string; firstName: string; lastName: string; name: string; age: string | null; photoImageId: string | null; excerpt: string | null; appearances: number }

export async function listCharacters(db: DB, userId: string): Promise<CharacterCard[] | null> {
  if (!(await can(db, userId, 'read', SECTION))) return null;
  const { results } = await db
    .prepare(
      `SELECT c.id AS id, c.first_name AS firstName, c.last_name AS lastName, c.age AS age, c.photo_image_id AS photoImageId, c.personality AS personality,
              (SELECT COUNT(*) FROM character_appearances a JOIN resources er ON er.id = a.episode_id AND er.archived_at IS NULL WHERE a.character_id = c.id) AS appearances
       FROM characters c JOIN resources r ON r.id = c.id AND r.archived_at IS NULL ORDER BY LOWER(c.first_name), LOWER(c.last_name), c.created_at`,
    )
    .all<{ id: string; firstName: string; lastName: string; age: string | null; photoImageId: string | null; personality: string | null; appearances: number }>();
  const ok = await readableIds(db, userId, results.map((r) => r.id));
  return results.filter((r) => ok.has(r.id)).map(({ personality, ...r }) => ({ ...r, name: displayName(r), excerpt: personality ? personality.slice(0, 140) : null }));
}

export interface CharacterDetail {
  id: string; firstName: string; lastName: string; name: string; age: string | null; photoImageId: string | null;
  physical: string | null; personality: string | null; history: string | null; qualities: string | null; flaws: string | null; particularities: string | null;
  relations: { id: string; otherId: string; otherName: string; otherPhotoImageId: string | null; kind: RelationKind; description: string | null }[];
  appearances: { episodeId: string; code: string; title: string; seasonId: string | null }[];
  canWrite: boolean;
}

export async function getCharacter(db: DB, userId: string, id: string): Promise<CharacterDetail | null> {
  if (!(await can(db, userId, 'read', id))) return null;
  const c = await db
    .prepare(
      `SELECT c.id AS id, c.first_name AS firstName, c.last_name AS lastName, c.age AS age, c.photo_image_id AS photoImageId, c.physical AS physical,
              c.personality AS personality, c.history AS history, c.qualities AS qualities, c.flaws AS flaws, c.particularities AS particularities
       FROM characters c JOIN resources r ON r.id = c.id AND r.archived_at IS NULL WHERE c.id = ?`,
    )
    .bind(id)
    .first<Omit<CharacterDetail, 'name' | 'relations' | 'appearances' | 'canWrite'>>();
  if (!c) return null;

  // Relations : n'apparaissent que celles dont l'autre personnage est lisible par cet utilisateur.
  const { results: rels } = await db
    .prepare(
      `SELECT rel.id AS id, o.id AS otherId, o.first_name AS f, o.last_name AS l, o.photo_image_id AS otherPhotoImageId, rel.kind AS kind, rel.description AS description
       FROM character_relations rel
       JOIN characters o ON o.id = CASE WHEN rel.character_a = ? THEN rel.character_b ELSE rel.character_a END
       JOIN resources orr ON orr.id = o.id AND orr.archived_at IS NULL
       WHERE rel.character_a = ? OR rel.character_b = ? ORDER BY rel.created_at, rel.rowid`,
    )
    .bind(id, id, id)
    .all<{ id: string; otherId: string; f: string; l: string; otherPhotoImageId: string | null; kind: RelationKind; description: string | null }>();
  const okRel = await readableIds(db, userId, rels.map((r) => r.otherId));

  const { results: apps } = await db
    .prepare(
      `SELECT e.id AS episodeId, e.title AS title, e.kind AS kind, e.number AS number, e.season_id AS seasonId, s.number AS seasonNumber
       FROM character_appearances a JOIN episodes e ON e.id = a.episode_id JOIN resources er ON er.id = e.id AND er.archived_at IS NULL
       LEFT JOIN seasons s ON s.id = e.season_id WHERE a.character_id = ? ORDER BY COALESCE(s.position, 9999), e.position`,
    )
    .bind(id)
    .all<{ episodeId: string; title: string; kind: EpisodeKind; number: number | null; seasonId: string | null; seasonNumber: number | null }>();
  const okEp = await readableIds(db, userId, apps.map((a) => a.episodeId));

  return {
    ...c,
    name: displayName(c),
    relations: rels.filter((r) => okRel.has(r.otherId)).map((r) => ({ id: r.id, otherId: r.otherId, otherName: displayName({ firstName: r.f, lastName: r.l }), otherPhotoImageId: r.otherPhotoImageId, kind: r.kind, description: r.description })),
    appearances: apps.filter((a) => okEp.has(a.episodeId)).map((a) => ({ episodeId: a.episodeId, code: episodeCode(a.kind, a.seasonNumber, a.seasonId !== null, a.number), title: a.title, seasonId: a.seasonId })),
    canWrite: await can(db, userId, 'write', id),
  };
}

export interface CharacterInput { firstName?: unknown; lastName?: unknown; age?: unknown; physical?: unknown; personality?: unknown; history?: unknown; qualities?: unknown; flaws?: unknown; particularities?: unknown }

function parseFields(input: CharacterInput, partial: boolean): { sets: string[]; vals: unknown[] } | { error: string } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of [['firstName', 'first_name'], ['lastName', 'last_name']] as const) {
    if (partial && !(k in input)) continue;
    const v = text(input[k] ?? '', 100);
    if (v === undefined) return { error: 'invalid_name' };
    sets.push(`${col} = ?`); vals.push(v ?? '');
  }
  if (!partial || 'age' in input) { const v = text(input.age, 40); if (v === undefined) return { error: 'invalid_age' }; sets.push('age = ?'); vals.push(v); }
  for (const k of Object.keys(TEXT_FIELDS) as (keyof typeof TEXT_FIELDS)[]) {
    if (partial && !(k in input)) continue;
    const v = text(input[k], 10000);
    if (v === undefined) return { error: 'invalid_text' };
    sets.push(`${TEXT_FIELDS[k]} = ?`); vals.push(v);
  }
  return { sets, vals };
}

export async function createCharacter(db: DB, actorId: string, input: CharacterInput): Promise<Result<{ id: string }>> {
  if (!(await can(db, actorId, 'write', SECTION))) return { ok: false, reason: 'forbidden' };
  const p = parseFields(input, false);
  if ('error' in p) return { ok: false, reason: p.error };
  if (!String(input.firstName ?? '').trim() && !String(input.lastName ?? '').trim()) return { ok: false, reason: 'name_required' };
  const id = newId();
  const now = nowIso();
  const cols = p.sets.map((s) => s.split(' = ')[0]);
  await db.batch([
    db.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'item', ?)").bind(id, SECTION),
    db.prepare(`INSERT INTO characters (id, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`).bind(id, ...p.vals, now, now),
    logStmt(db, { actor: actorId, action: 'character.created', resourceType: 'character', resourceId: id }),
  ]);
  return { ok: true, id };
}

export async function updateCharacter(db: DB, actorId: string, id: string, patch: CharacterInput): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const cur = await db.prepare('SELECT c.first_name AS f, c.last_name AS l FROM characters c JOIN resources r ON r.id = c.id AND r.archived_at IS NULL WHERE c.id = ?').bind(id).first<{ f: string; l: string }>();
  if (!cur) return { ok: false, reason: 'not_found' };
  const p = parseFields(patch, true);
  if ('error' in p) return { ok: false, reason: p.error };
  if (p.sets.length === 0) return { ok: false, reason: 'nothing_to_update' };
  const f = 'firstName' in patch ? String(patch.firstName ?? '').trim() : cur.f;
  const l = 'lastName' in patch ? String(patch.lastName ?? '').trim() : cur.l;
  if (!f && !l) return { ok: false, reason: 'name_required' };
  await db.batch([
    db.prepare(`UPDATE characters SET ${p.sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...p.vals, nowIso(), id),
    logStmt(db, { actor: actorId, action: 'character.updated', resourceType: 'character', resourceId: id }),
  ]);
  return { ok: true };
}

/** Archivage (jamais de suppression). Les relations et apparitions sont conservées pour une restauration ultérieure. */
export async function archiveCharacter(db: DB, actorId: string, id: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const r = await db.prepare('SELECT 1 AS x FROM characters c JOIN resources x ON x.id = c.id AND x.archived_at IS NULL WHERE c.id = ?').bind(id).first();
  if (!r) return { ok: false, reason: 'not_found' };
  await db.batch([
    db.prepare('UPDATE resources SET archived_at = ? WHERE id = ?').bind(nowIso(), id),
    logStmt(db, { actor: actorId, action: 'character.archived', resourceType: 'character', resourceId: id }),
  ]);
  return { ok: true };
}

/** Remplace la photo. L'ancienne image est conservée en base (marquée « remplacée »), jamais supprimée. */
export async function setCharacterPhoto(db: DB, actorId: string, id: string, bytes: Uint8Array): Promise<Result<{ imageId: string }>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const cur = await db.prepare('SELECT c.photo_image_id AS p FROM characters c JOIN resources r ON r.id = c.id AND r.archived_at IS NULL WHERE c.id = ?').bind(id).first<{ p: string | null }>();
  if (!cur) return { ok: false, reason: 'not_found' };
  const img = await storeImage(db, actorId, id, bytes);
  if (!img.ok) return img;
  const now = nowIso();
  await db.batch([
    ...(cur.p ? [db.prepare('UPDATE images SET replaced_at = ? WHERE id = ?').bind(now, cur.p)] : []),
    db.prepare('UPDATE characters SET photo_image_id = ?, updated_at = ? WHERE id = ?').bind(img.id, now, id),
    logStmt(db, { actor: actorId, action: 'character.photo_changed', resourceType: 'character', resourceId: id }),
  ]);
  return { ok: true, imageId: img.id };
}

export async function removeCharacterPhoto(db: DB, actorId: string, id: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', id))) return { ok: false, reason: 'forbidden' };
  const cur = await db.prepare('SELECT photo_image_id AS p FROM characters WHERE id = ?').bind(id).first<{ p: string | null }>();
  if (!cur?.p) return { ok: false, reason: 'not_found' };
  const now = nowIso();
  await db.batch([
    db.prepare('UPDATE images SET replaced_at = ? WHERE id = ?').bind(now, cur.p),
    db.prepare('UPDATE characters SET photo_image_id = NULL, updated_at = ? WHERE id = ?').bind(now, id),
    logStmt(db, { actor: actorId, action: 'character.photo_changed', resourceType: 'character', resourceId: id }),
  ]);
  return { ok: true };
}

// ---------- Relations ----------

const activeCharacter = (db: DB, id: unknown) =>
  typeof id === 'string' ? db.prepare('SELECT 1 AS x FROM characters c JOIN resources r ON r.id = c.id AND r.archived_at IS NULL WHERE c.id = ?').bind(id).first() : Promise.resolve(null);

/** Relie deux personnages. Exige l'écriture sur les deux fiches (la relation apparaît sur les deux). */
export async function addRelation(db: DB, actorId: string, a: string, b: string, kind: unknown, description: unknown): Promise<Result<{ id: string }>> {
  if (a === b) return { ok: false, reason: 'same_character' };
  if (!RELATION_KINDS.includes(kind as RelationKind)) return { ok: false, reason: 'invalid_kind' };
  const d = text(description, 2000);
  if (d === undefined) return { ok: false, reason: 'invalid_text' };
  if (!(await can(db, actorId, 'write', a)) || !(await can(db, actorId, 'write', b))) return { ok: false, reason: 'forbidden' };
  if (!(await activeCharacter(db, a)) || !(await activeCharacter(db, b))) return { ok: false, reason: 'not_found' };
  const dup = await db.prepare('SELECT 1 AS x FROM character_relations WHERE kind = ? AND ((character_a = ? AND character_b = ?) OR (character_a = ? AND character_b = ?))').bind(kind, a, b, b, a).first();
  if (dup) return { ok: false, reason: 'already_exists' };
  const id = newId();
  await db.batch([
    db.prepare('INSERT INTO character_relations (id, character_a, character_b, kind, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, a, b, kind, d, actorId, nowIso()),
    logStmt(db, { actor: actorId, action: 'character.relation_added', resourceType: 'character', resourceId: a, details: { other: b, kind } }),
  ]);
  return { ok: true, id };
}

async function relationEnds(db: DB, relId: string) {
  return db.prepare('SELECT character_a AS a, character_b AS b FROM character_relations WHERE id = ?').bind(relId).first<{ a: string; b: string }>();
}

export async function updateRelation(db: DB, actorId: string, relId: string, patch: { kind?: unknown; description?: unknown }): Promise<Result<object>> {
  const r = await relationEnds(db, relId);
  if (!r) return { ok: false, reason: 'not_found' };
  if (!(await can(db, actorId, 'write', r.a)) || !(await can(db, actorId, 'write', r.b))) return { ok: false, reason: 'forbidden' };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('kind' in patch) { if (!RELATION_KINDS.includes(patch.kind as RelationKind)) return { ok: false, reason: 'invalid_kind' }; sets.push('kind = ?'); vals.push(patch.kind); }
  if ('description' in patch) { const d = text(patch.description, 2000); if (d === undefined) return { ok: false, reason: 'invalid_text' }; sets.push('description = ?'); vals.push(d); }
  if (sets.length === 0) return { ok: false, reason: 'nothing_to_update' };
  await db.batch([
    db.prepare(`UPDATE character_relations SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, relId),
    logStmt(db, { actor: actorId, action: 'character.relation_updated', resourceType: 'character', resourceId: r.a }),
  ]);
  return { ok: true };
}

/** Supprime le lien de relation (pas les personnages). */
export async function removeRelation(db: DB, actorId: string, relId: string): Promise<Result<object>> {
  const r = await relationEnds(db, relId);
  if (!r) return { ok: false, reason: 'not_found' };
  if (!(await can(db, actorId, 'write', r.a)) || !(await can(db, actorId, 'write', r.b))) return { ok: false, reason: 'forbidden' };
  await db.batch([
    db.prepare('DELETE FROM character_relations WHERE id = ?').bind(relId),
    logStmt(db, { actor: actorId, action: 'character.relation_removed', resourceType: 'character', resourceId: r.a, details: { other: r.b } }),
  ]);
  return { ok: true };
}

// ---------- Apparitions manuelles ----------

/**
 * Renseigne qu'un personnage apparaît dans un épisode. Règle : écriture sur l'une des deux fiches (celle depuis laquelle on agit)
 * ET lecture de l'autre. Aucune détection automatique dans les scénarios.
 */
export async function addAppearance(db: DB, actorId: string, characterId: string, episodeId: string): Promise<Result<object>> {
  const w = (await can(db, actorId, 'write', characterId)) || (await can(db, actorId, 'write', episodeId));
  if (!w || !(await can(db, actorId, 'read', characterId)) || !(await can(db, actorId, 'read', episodeId))) return { ok: false, reason: 'forbidden' };
  const ep = await db.prepare('SELECT 1 AS x FROM episodes e JOIN resources r ON r.id = e.id AND r.archived_at IS NULL WHERE e.id = ?').bind(episodeId).first();
  if (!ep || !(await activeCharacter(db, characterId))) return { ok: false, reason: 'not_found' };
  const r = await db.prepare('INSERT OR IGNORE INTO character_appearances (character_id, episode_id, created_by, created_at) VALUES (?, ?, ?, ?)').bind(characterId, episodeId, actorId, nowIso()).run();
  if (r.meta.changes === 0) return { ok: false, reason: 'already_exists' };
  await db.batch([logStmt(db, { actor: actorId, action: 'character.appearance_added', resourceType: 'character', resourceId: characterId, details: { episode: episodeId } })]);
  return { ok: true };
}

export async function removeAppearance(db: DB, actorId: string, characterId: string, episodeId: string): Promise<Result<object>> {
  if (!((await can(db, actorId, 'write', characterId)) || (await can(db, actorId, 'write', episodeId)))) return { ok: false, reason: 'forbidden' };
  const r = await db.prepare('DELETE FROM character_appearances WHERE character_id = ? AND episode_id = ?').bind(characterId, episodeId).run();
  if (r.meta.changes === 0) return { ok: false, reason: 'not_found' };
  await db.batch([logStmt(db, { actor: actorId, action: 'character.appearance_removed', resourceType: 'character', resourceId: characterId, details: { episode: episodeId } })]);
  return { ok: true };
}

/** Personnages présents dans un épisode (filtrés par permissions). */
export async function charactersOfEpisode(db: DB, userId: string, episodeId: string): Promise<{ id: string; name: string; photoImageId: string | null }[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS id, c.first_name AS firstName, c.last_name AS lastName, c.photo_image_id AS photoImageId
       FROM character_appearances a JOIN characters c ON c.id = a.character_id JOIN resources r ON r.id = c.id AND r.archived_at IS NULL
       WHERE a.episode_id = ? ORDER BY LOWER(c.first_name), LOWER(c.last_name)`,
    )
    .bind(episodeId)
    .all<{ id: string; firstName: string; lastName: string; photoImageId: string | null }>();
  const ok = await readableIds(db, userId, results.map((r) => r.id));
  return results.filter((r) => ok.has(r.id)).map((r) => ({ id: r.id, name: displayName(r), photoImageId: r.photoImageId }));
}
