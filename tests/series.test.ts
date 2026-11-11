import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDashboard } from '../src/lib/dashboard.ts';
import { getSeries, updateSeries } from '../src/lib/series.ts';
import { grant, makeDb, seed } from './helpers/db.ts';

function setup() {
  const db = makeDb();
  seed(db);
  return db;
}

test('fiche : lecture pour tous les membres, refus pour les inconnus', async () => {
  const db = setup();
  assert.equal((await getSeries(db, 'reader'))?.title, 'Ma série');
  assert.equal(await getSeries(db, 'inconnu'), null);
});

test('fiche : un lecteur ne peut pas modifier, un éditeur oui', async () => {
  const db = setup();
  assert.deepEqual(await updateSeries(db, 'reader', { title: 'X' }), { ok: false, reason: 'forbidden' });
  assert.equal((await getSeries(db, 'owner'))?.title, 'Ma série');
  assert.deepEqual(await updateSeries(db, 'editor', { title: 'Mon titre', genre: 'Comédie' }), { ok: true, changed: ['title', 'genre'] });
  const s = await getSeries(db, 'owner');
  assert.equal(s?.title, 'Mon titre');
  assert.equal(s?.genre, 'Comédie');
  assert.ok(s?.updatedAt);
});

test('fiche : exception « lecture seule » sur la série empêche un éditeur de modifier', async () => {
  const db = setup();
  grant(db, 'editor', 'series', 'read');
  assert.deepEqual(await updateSeries(db, 'editor', { title: 'X' }), { ok: false, reason: 'forbidden' });
});

test('fiche : validation côté serveur', async () => {
  const db = setup();
  assert.deepEqual(await updateSeries(db, 'owner', { title: '   ' }), { ok: false, reason: 'invalid_title' });
  assert.deepEqual(await updateSeries(db, 'owner', { title: 'a'.repeat(201) }), { ok: false, reason: 'invalid_title' });
  assert.deepEqual(await updateSeries(db, 'owner', { plannedSeasons: 0 }), { ok: false, reason: 'invalid_plannedSeasons' });
  assert.deepEqual(await updateSeries(db, 'owner', { plannedSeasons: 2.5 }), { ok: false, reason: 'invalid_plannedSeasons' });
  assert.deepEqual(await updateSeries(db, 'owner', { avgDurationMin: 601 }), { ok: false, reason: 'invalid_avgDurationMin' });
  assert.deepEqual(await updateSeries(db, 'owner', { accentColor: 'rouge' }), { ok: false, reason: 'invalid_accentColor' });
  assert.deepEqual(await updateSeries(db, 'owner', { accentColor: '#fff; background:url(x)' }), { ok: false, reason: 'invalid_accentColor' });
  assert.deepEqual(await updateSeries(db, 'owner', { summary: 12 as never }), { ok: false, reason: 'invalid_summary' });
  assert.deepEqual(await updateSeries(db, 'owner', {}), { ok: false, reason: 'nothing_to_update' });
  assert.deepEqual(await updateSeries(db, 'owner', { plannedSeasons: 3, avgDurationMin: 22, accentColor: '#2563eb' }), { ok: true, changed: ['plannedSeasons', 'avgDurationMin', 'accentColor'] });
  const s = await getSeries(db, 'owner');
  assert.deepEqual([s?.plannedSeasons, s?.avgDurationMin, s?.accentColor], [3, 22, '#2563eb']);
});

test('fiche : champs vides remis à null, champs inconnus ignorés (pas d’injection de colonne)', async () => {
  const db = setup();
  await updateSeries(db, 'owner', { summary: 'Un résumé' });
  assert.deepEqual(await updateSeries(db, 'owner', { summary: '' }), { ok: true, changed: ['summary'] });
  assert.equal((await getSeries(db, 'owner'))?.summary, null);
  assert.deepEqual(await updateSeries(db, 'owner', { id: 'autre', 'title = 1; DROP TABLE users; --': 'x' } as never), { ok: false, reason: 'nothing_to_update' });
  assert.equal((db.raw.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 4);
});

test('fiche : le journal garde les noms des champs, pas leur contenu', async () => {
  const db = setup();
  await updateSeries(db, 'owner', { notes: 'secret de scénario' });
  const row = db.raw.prepare("SELECT details FROM activity_log WHERE action = 'series.updated'").get() as { details: string };
  assert.ok(!row.details.includes('secret'));
  assert.deepEqual(JSON.parse(row.details), { fields: ['notes'] });
});

test('tableau de bord : compteurs réels et activité réservée aux administrateurs', async () => {
  const db = setup();
  await updateSeries(db, 'owner', { genre: 'Comédie' });
  const admin = await getDashboard(db, 'owner');
  assert.deepEqual({ ...admin?.members }, { total: 4, admins: 2, editors: 1, readers: 1 });
  assert.equal(admin?.recentActivity?.length, 1);
  assert.equal(admin?.recentActivity?.[0].action, 'series.updated');
  const reader = await getDashboard(db, 'reader');
  assert.equal(reader?.recentActivity, null);
  assert.equal(await getDashboard(db, 'inconnu'), null);
});
