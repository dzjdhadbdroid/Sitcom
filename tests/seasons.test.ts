// Tests des saisons, épisodes et documents associés (données fictives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archive, createEpisode, createSeason, episodeCode, getEpisode, linkDocument, listSeasons, reorderEpisodes, reorderSeasons, setMainDocument, unlinkDocument, updateEpisode, updateSeason } from '../src/lib/seasons.ts';
import { can } from '../src/lib/permissions.ts';
import { grant, makeDb, seed } from './helpers/db.ts';

const db0 = () => { const db = makeDb(); seed(db); return db; };
const ids = async (db: ReturnType<typeof makeDb>, user: string) => (await listSeasons(db, user))!;

function addDoc(db: ReturnType<typeof makeDb>, id: string, state = 'imported') {
  db.raw.prepare("INSERT INTO drive_documents (id, user_id, drive_file_id, title, mime_type, state, category, section_id, last_seen_at) VALUES (?, 'editor', ?, ?, 'application/vnd.google-apps.document', ?, 'script', 'section:documents', 'x')").run(id, `f-${id}`, `Doc ${id}`, state);
  if (state === 'imported') db.raw.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'item', 'section:documents')").run(id);
}

test('numéro de référence : S01E01, spéciaux, hors saison', () => {
  assert.equal(episodeCode('regular', 1, true, 3), 'S01E03');
  assert.equal(episodeCode('pilot', 1, true, 1), 'S01E01');
  assert.equal(episodeCode('special', 2, true, 1), 'S02SP01');
  assert.equal(episodeCode('bonus', null, false, 2), 'HSBN02');
  assert.equal(episodeCode('regular', 1, true, null), 'S01');
});

test('création de saison : vide ou avec emplacements générés, numéro automatique', async () => {
  const db = db0();
  const empty = await createSeason(db, 'editor', { title: 'Saison un' });
  assert.equal(empty.ok && empty.episodeIds.length, 0);
  const full = await createSeason(db, 'editor', { episodeCount: 8 });
  assert.equal(full.ok && full.episodeIds.length, 8);
  const { seasons } = await ids(db, 'editor');
  assert.deepEqual(seasons.map((s) => s.number), [1, 2]);
  assert.deepEqual(seasons[1].episodes.map((e) => e.code), ['S02E01', 'S02E02', 'S02E03', 'S02E04', 'S02E05', 'S02E06', 'S02E07', 'S02E08']);
  assert.ok(seasons[1].episodes.every((e) => e.status === 'idea' && e.title === ''));
  // chaque saison et épisode est une ressource de l'arbre des permissions
  assert.equal(await can(db, 'reader', 'read', seasons[1].episodes[0].id), true);
  assert.equal(await can(db, 'reader', 'write', seasons[1].episodes[0].id), false);
});

test('création de saison : validations et droits', async () => {
  const db = db0();
  assert.deepEqual(await createSeason(db, 'reader', {}), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await createSeason(db, 'inconnu', {}), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await createSeason(db, 'editor', { episodeCount: 500 }), { ok: false, reason: 'invalid_episode_count' });
  assert.deepEqual(await createSeason(db, 'editor', { number: 'abc' }), { ok: false, reason: 'invalid_number' });
  assert.deepEqual(await createSeason(db, 'editor', { title: 'x'.repeat(201) }), { ok: false, reason: 'invalid_title' });
  grant(db, 'editor', 'section:seasons', 'read');
  assert.deepEqual(await createSeason(db, 'editor', {}), { ok: false, reason: 'forbidden' });
});

test('épisodes : création, numérotation automatique, types, statuts prédéfinis uniquement', async () => {
  const db = db0();
  const s = await createSeason(db, 'editor', { title: 'S1' });
  assert.ok(s.ok);
  const season = s.ok ? s.id : '';
  const a = await createEpisode(db, 'editor', { seasonId: season, title: 'Pilote', kind: 'pilot' });
  const b = await createEpisode(db, 'editor', { seasonId: season, title: 'Deux' });
  const sp = await createEpisode(db, 'editor', { seasonId: season, title: 'Spécial Noël', kind: 'special' });
  const loose = await createEpisode(db, 'editor', { seasonId: null, title: 'Bonus', kind: 'bonus' });
  assert.ok(a.ok && b.ok && sp.ok && loose.ok);
  const r = await ids(db, 'editor');
  assert.deepEqual(r.seasons[0].episodes.map((e) => [e.code, e.title]), [['S01E01', 'Pilote'], ['S01E01', 'Deux'], ['S01SP01', 'Spécial Noël']]);
  assert.deepEqual(r.loose.map((e) => e.code), ['HSBN01']);
  assert.deepEqual(await createEpisode(db, 'editor', { seasonId: season, status: 'custom' }), { ok: false, reason: 'invalid_status' });
  assert.deepEqual(await createEpisode(db, 'editor', { seasonId: season, kind: 'x' }), { ok: false, reason: 'invalid_kind' });
  assert.deepEqual(await createEpisode(db, 'editor', { seasonId: 'nope' }), { ok: false, reason: 'season_not_found' });
  assert.deepEqual(await createEpisode(db, 'editor', { seasonId: season, durationMin: 0 }), { ok: false, reason: 'invalid_duration' });
  assert.deepEqual(await createEpisode(db, 'reader', { seasonId: season }), { ok: false, reason: 'forbidden' });
});

test('modification : titre, numéro, statut, durée ; marquage manuel « terminée »', async () => {
  const db = db0();
  const s = await createSeason(db, 'editor', { episodeCount: 2 });
  assert.ok(s.ok);
  const ep = s.ok ? s.episodeIds[0] : '';
  assert.deepEqual(await updateEpisode(db, 'editor', ep, { title: 'Titre', number: 5, status: 'writing', durationMin: 22, summary: 'Résumé' }), { ok: true });
  const d = await getEpisode(db, 'reader', ep);
  assert.deepEqual([d?.title, d?.code, d?.status, d?.durationMin, d?.canWrite], ['Titre', 'S01E05', 'writing', 22, false]);
  assert.deepEqual(await updateEpisode(db, 'reader', ep, { title: 'x' }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await updateEpisode(db, 'editor', ep, {}), { ok: false, reason: 'nothing_to_update' });
  assert.deepEqual(await updateEpisode(db, 'editor', ep, { status: 'fini' }), { ok: false, reason: 'invalid_status' });
  assert.deepEqual(await updateSeason(db, 'editor', s.ok ? s.id : '', { finished: true }), { ok: true });
  assert.ok((await ids(db, 'editor')).seasons[0].finishedAt);
  assert.deepEqual(await updateSeason(db, 'editor', s.ok ? s.id : '', { finished: false }), { ok: true });
  assert.equal((await ids(db, 'editor')).seasons[0].finishedAt, null);
  assert.deepEqual(await updateSeason(db, 'editor', s.ok ? s.id : '', { number: 3, title: 'Nouvelle' }), { ok: true });
  assert.equal((await ids(db, 'editor')).seasons[0].episodes[1].code, 'S03E02');
});

test('réorganisation : épisodes et saisons, sans perte de documents ni changement d’identité', async () => {
  const db = db0();
  addDoc(db, 'dA');
  const s = await createSeason(db, 'editor', { episodeCount: 3 });
  assert.ok(s.ok);
  const [e1, e2, e3] = s.ok ? s.episodeIds : [];
  assert.deepEqual(await linkDocument(db, 'editor', e1, 'dA', true), { ok: true });
  assert.deepEqual(await reorderEpisodes(db, 'editor', s.ok ? s.id : null, [e3, e1, e2]), { ok: true });
  const eps = (await ids(db, 'editor')).seasons[0].episodes;
  assert.deepEqual(eps.map((e) => e.id), [e3, e1, e2]);
  assert.deepEqual(eps.map((e) => e.code), ['S01E03', 'S01E01', 'S01E02']); // numéros inchangés : l'ordre d'affichage est indépendant
  assert.equal((await getEpisode(db, 'editor', e1))?.documents[0].isMain, true);
  assert.deepEqual(await reorderEpisodes(db, 'editor', s.ok ? s.id : null, [e1, e1]), { ok: false, reason: 'invalid_order' });
  assert.deepEqual(await reorderEpisodes(db, 'editor', s.ok ? s.id : null, ['inconnu']), { ok: false, reason: 'invalid_order' });
  assert.deepEqual(await reorderEpisodes(db, 'reader', s.ok ? s.id : null, [e1, e2]), { ok: false, reason: 'forbidden' });
  const s2 = await createSeason(db, 'editor', {});
  assert.ok(s2.ok);
  assert.deepEqual(await reorderSeasons(db, 'editor', [s2.ok ? s2.id : '', s.ok ? s.id : '']), { ok: true });
  assert.deepEqual((await ids(db, 'editor')).seasons.map((x) => x.number), [2, 1]);
});

test('réorganisation : les éléments invisibles gardent leur place', async () => {
  const db = db0();
  const s = await createSeason(db, 'editor', { episodeCount: 3 });
  assert.ok(s.ok);
  const [e1, e2, e3] = s.ok ? s.episodeIds : [];
  grant(db, 'editor', e2, 'none');
  assert.deepEqual(await reorderEpisodes(db, 'editor', s.ok ? s.id : null, [e3, e1]), { ok: true });
  assert.deepEqual((await ids(db, 'owner')).seasons[0].episodes.map((e) => e.id), [e3, e2, e1]);
});

test('déplacement d’un épisode vers une autre saison / hors saison : documents conservés, droit sur la destination exigé', async () => {
  const db = db0();
  addDoc(db, 'dA');
  const a = await createSeason(db, 'editor', { episodeCount: 1 });
  const b = await createSeason(db, 'editor', {});
  assert.ok(a.ok && b.ok);
  const ep = a.ok ? a.episodeIds[0] : '';
  await linkDocument(db, 'editor', ep, 'dA');
  assert.deepEqual(await updateEpisode(db, 'editor', ep, { seasonId: b.ok ? b.id : '' }), { ok: true });
  let d = await getEpisode(db, 'editor', ep);
  assert.deepEqual([d?.seasonId, d?.documents.length, d?.code], [b.ok ? b.id : '', 1, 'S02E01']);
  assert.equal((db.raw.prepare('SELECT parent_id FROM resources WHERE id = ?').get(ep) as { parent_id: string }).parent_id, b.ok ? b.id : '');
  assert.deepEqual(await updateEpisode(db, 'editor', ep, { seasonId: null }), { ok: true });
  d = await getEpisode(db, 'editor', ep);
  assert.deepEqual([d?.seasonId, d?.code], [null, 'HSE01']);
  grant(db, 'editor', a.ok ? a.id : '', 'read');
  assert.deepEqual(await updateEpisode(db, 'editor', ep, { seasonId: a.ok ? a.id : '' }), { ok: false, reason: 'forbidden' });
});

test('permissions : exception sur une saison ; lecture seule ailleurs ; liste filtrée côté serveur', async () => {
  const db = db0();
  const a = await createSeason(db, 'owner', { episodeCount: 2 });
  const b = await createSeason(db, 'owner', { episodeCount: 2 });
  assert.ok(a.ok && b.ok);
  // « peut modifier uniquement la saison 2 et ses épisodes »
  grant(db, 'reader', 'section:seasons', 'read');
  grant(db, 'reader', b.ok ? b.id : '', 'write');
  assert.equal(await can(db, 'reader', 'write', b.ok ? b.episodeIds[0] : ''), true);
  assert.equal(await can(db, 'reader', 'write', a.ok ? a.episodeIds[0] : ''), false);
  assert.deepEqual(await updateEpisode(db, 'reader', b.ok ? b.episodeIds[0] : '', { title: 'ok' }), { ok: true });
  assert.deepEqual(await updateEpisode(db, 'reader', a.ok ? a.episodeIds[0] : '', { title: 'non' }), { ok: false, reason: 'forbidden' });
  // saison masquée à un utilisateur : absente de la liste ET de la fiche
  grant(db, 'editor', a.ok ? a.id : '', 'none');
  const list = await ids(db, 'editor');
  assert.deepEqual(list.seasons.map((s) => s.id), [b.ok ? b.id : '']);
  assert.equal(await getEpisode(db, 'editor', a.ok ? a.episodeIds[0] : ''), null);
  // rubrique entière masquée
  grant(db, 'admin2', 'section:seasons', 'none'); // un admin n'est jamais restreint
  assert.ok(await listSeasons(db, 'admin2'));
  const db2 = db0();
  grant(db2, 'reader', 'section:seasons', 'none');
  assert.equal(await listSeasons(db2, 'reader'), null);
});

test('documents associés : plusieurs par épisode, un seul scénario principal, droits de lecture du document', async () => {
  const db = db0();
  addDoc(db, 'd1'); addDoc(db, 'd2'); addDoc(db, 'd3', 'available');
  const s = await createSeason(db, 'editor', { episodeCount: 1 });
  const ep = s.ok ? s.episodeIds[0] : '';
  assert.deepEqual(await linkDocument(db, 'editor', ep, 'd1', true), { ok: true });
  assert.deepEqual(await linkDocument(db, 'editor', ep, 'd2'), { ok: true });
  assert.deepEqual(await linkDocument(db, 'editor', ep, 'd3'), { ok: false, reason: 'forbidden' }); // non importé : pas une ressource
  assert.deepEqual(await linkDocument(db, 'editor', ep, 'zzz'), { ok: false, reason: 'forbidden' });
  let d = await getEpisode(db, 'editor', ep);
  assert.deepEqual(d?.documents.map((x) => [x.id, x.isMain]), [['d1', true], ['d2', false]]);
  assert.equal(d?.hasMainScript, true);
  assert.deepEqual(await setMainDocument(db, 'editor', ep, 'd2'), { ok: true });
  d = await getEpisode(db, 'editor', ep);
  assert.deepEqual(d?.documents.map((x) => [x.id, x.isMain]), [['d2', true], ['d1', false]]);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM episode_documents WHERE is_main = 1').get()?.n, 1);
  assert.deepEqual(await setMainDocument(db, 'editor', ep, 'd3'), { ok: false, reason: 'not_found' });
  assert.deepEqual(await setMainDocument(db, 'editor', ep, null), { ok: true });
  assert.equal((await getEpisode(db, 'editor', ep))?.hasMainScript, false);
  // re-lier sans « principal » ne retire pas le statut principal
  await setMainDocument(db, 'editor', ep, 'd1');
  await linkDocument(db, 'editor', ep, 'd1', false);
  assert.equal((await getEpisode(db, 'editor', ep))?.hasMainScript, true);
  // un document interdit à un lecteur n'apparaît pas dans la fiche
  grant(db, 'reader', 'd2', 'none');
  assert.deepEqual((await getEpisode(db, 'reader', ep))?.documents.map((x) => x.id), ['d1']);
  // un éditeur privé de lecture du document ne peut pas le rattacher
  grant(db, 'editor', 'd2', 'none');
  const e2 = await createEpisode(db, 'editor', { seasonId: s.ok ? s.id : null });
  assert.deepEqual(await linkDocument(db, 'editor', e2.ok ? e2.id : '', 'd2'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await linkDocument(db, 'reader', ep, 'd1'), { ok: false, reason: 'forbidden' });
});

test('détacher un document : le lien seul disparaît, la référence importée reste', async () => {
  const db = db0();
  addDoc(db, 'd1');
  const s = await createSeason(db, 'editor', { episodeCount: 1 });
  const ep = s.ok ? s.episodeIds[0] : '';
  await linkDocument(db, 'editor', ep, 'd1', true);
  assert.deepEqual(await unlinkDocument(db, 'reader', ep, 'd1'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await unlinkDocument(db, 'editor', ep, 'd1'), { ok: true });
  assert.deepEqual(await unlinkDocument(db, 'editor', ep, 'd1'), { ok: false, reason: 'not_found' });
  assert.equal(db.raw.prepare("SELECT state FROM drive_documents WHERE id = 'd1'").get()?.state, 'imported');
});

test('document inaccessible ou supprimé côté Drive : reste rattaché avec son avertissement', async () => {
  const db = db0();
  addDoc(db, 'd1');
  const s = await createSeason(db, 'editor', { episodeCount: 1 });
  const ep = s.ok ? s.episodeIds[0] : '';
  await linkDocument(db, 'editor', ep, 'd1');
  db.raw.prepare("UPDATE drive_documents SET status = 'removed', status_detail = 'Supprimé' WHERE id = 'd1'").run();
  const d = await getEpisode(db, 'editor', ep);
  assert.deepEqual([d?.documents.length, d?.documents[0].status], [1, 'removed']);
});

test('archivage : jamais de suppression définitive ; l’archivage d’une saison archive ses épisodes', async () => {
  const db = db0();
  addDoc(db, 'd1');
  const s = await createSeason(db, 'editor', { episodeCount: 2 });
  assert.ok(s.ok);
  await linkDocument(db, 'editor', s.ok ? s.episodeIds[0] : '', 'd1');
  assert.deepEqual(await archive(db, 'reader', s.ok ? s.id : '', ), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await archive(db, 'editor', s.ok ? s.episodeIds[1] : ''), { ok: true });
  assert.equal((await ids(db, 'editor')).seasons[0].episodes.length, 1);
  assert.deepEqual(await archive(db, 'editor', s.ok ? s.episodeIds[1] : ''), { ok: false, reason: 'not_found' });
  assert.deepEqual(await archive(db, 'editor', s.ok ? s.id : ''), { ok: true });
  assert.equal((await ids(db, 'editor')).seasons.length, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM episodes').get()?.n, 2);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM episode_documents').get()?.n, 1);
  assert.deepEqual(await archive(db, 'editor', 'series'), { ok: false, reason: 'not_found' });
  // le numéro de la prochaine saison ne réutilise pas celui d'une saison archivée de façon incohérente
  const n = await createSeason(db, 'editor', {});
  assert.ok(n.ok);
  assert.equal((await ids(db, 'editor')).seasons[0].number, 1);
});

test('actions journalisées sans contenu sensible', async () => {
  const db = db0();
  const s = await createSeason(db, 'editor', { title: 'Secret fictif', episodeCount: 1 });
  await updateEpisode(db, 'editor', s.ok ? s.episodeIds[0] : '', { title: 'Titre confidentiel', summary: 'Résumé confidentiel' });
  const log = JSON.stringify(db.raw.prepare("SELECT * FROM activity_log WHERE action LIKE 'season.%' OR action LIKE 'episode.%'").all());
  assert.ok(log.includes('season.created') && log.includes('episode.updated'));
  assert.ok(!log.includes('confidentiel') && !log.includes('Secret fictif'));
});

test('tableau de bord : épisodes par statut et avancement par saison, filtrés par permissions', async () => {
  const { getDashboard } = await import('../src/lib/dashboard.ts');
  const db = db0();
  const a = await createSeason(db, 'editor', { episodeCount: 3 });
  const b = await createSeason(db, 'editor', { episodeCount: 2 });
  assert.ok(a.ok && b.ok);
  await updateEpisode(db, 'editor', a.ok ? a.episodeIds[0] : '', { status: 'done' });
  await updateEpisode(db, 'editor', a.ok ? a.episodeIds[1] : '', { status: 'validated' });
  await updateEpisode(db, 'editor', b.ok ? b.episodeIds[0] : '', { status: 'writing' });
  const d = await getDashboard(db, 'owner');
  assert.deepEqual({ ...d?.episodes.byStatus }, { idea: 2, writing: 1, done: 1, validated: 1 });
  assert.equal(d?.episodes.total, 5);
  assert.deepEqual(d?.seasons.map((s) => [s.total, s.completed]), [[3, 2], [2, 0]]);
  grant(db, 'reader', a.ok ? a.id : '', 'none');
  const r = await getDashboard(db, 'reader');
  assert.deepEqual([r?.episodes.total, r?.seasons.length], [2, 1]);
});
