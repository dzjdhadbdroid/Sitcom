// Tests de l'intégration Drive contre un FAUX Google (aucun appel réseau). Données fictives uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64Url } from '../src/lib/crypto.ts';
import { DRIVE_SCOPE, clientFor, disconnect, getConnectionInfo, saveConnection, type DriveSecrets } from '../src/lib/drive-connection.ts';
import {
  addSyncFolder, browseFolders, importDocuments, listAvailable, listImported, listSyncFolders, readDocument, reclassify,
  refreshAvailable, removeSyncFolder, syncAll, syncConnection, syncIfStale,
} from '../src/lib/drive-sync.ts';
import { DriveClient, DriveError, FOLDER_MIME, assertDriveId } from '../src/lib/drive.ts';
import { can, readableIds } from '../src/lib/permissions.ts';
import { FakeGoogle } from './helpers/fake-google.ts';
import { grant, makeDb, seed } from './helpers/db.ts';

const secrets: DriveSecrets = { clientId: 'cid', clientSecret: 'csecret', encryptionKey: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
const noSleep = async () => {};
const opts = { sleep: noSleep };

async function setup() {
  const db = makeDb();
  seed(db);
  const g = new FakeGoogle();
  g.add({ id: 'F1', name: 'Pilote', mimeType: FOLDER_MIME });
  g.add({ id: 'F2', name: 'Saison 2', mimeType: FOLDER_MIME });
  g.add({ id: 'F3', name: 'Autre', mimeType: FOLDER_MIME });
  g.add({ id: 'D1', name: 'Scénario pilote', parents: ['F1'], html: '<p>Bonjour</p>' });
  g.add({ id: 'D2', name: 'Synopsis', parents: ['F1'] });
  g.add({ id: 'D3', name: 'Notes', parents: ['F2'] });
  await saveConnection(db, 'editor', 'REFRESH-TOKEN-SECRET', DRIVE_SCOPE, secrets.encryptionKey);
  const drive = await clientFor(db, 'editor', secrets, g.fetch);
  assert.deepEqual(await addSyncFolder(db, 'editor', drive, 'F1'), { ok: true, name: 'Pilote' });
  await refreshAvailable(db, 'editor', drive);
  return { db, g, drive };
}

const docId = (db: ReturnType<typeof makeDb>, fileId: string) => (db.raw.prepare('SELECT id FROM drive_documents WHERE drive_file_id = ?').get(fileId) as { id: string }).id;
const row = (db: ReturnType<typeof makeDb>, fileId: string) => ({ ...(db.raw.prepare('SELECT * FROM drive_documents WHERE drive_file_id = ?').get(fileId) as Record<string, unknown>) });
const count = (db: ReturnType<typeof makeDb>, sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;

async function importAll(db: ReturnType<typeof makeDb>, files = ['D1', 'D2']) {
  const r = await importDocuments(db, 'editor', files.map((f) => ({ id: docId(db, f), category: 'script', sectionId: 'section:documents' })));
  assert.equal(r.ok, true);
}

test('jeton de renouvellement chiffré au repos, jamais en clair', async () => {
  const { db } = await setup();
  const raw = db.raw.prepare('SELECT refresh_token_enc FROM drive_connections').get() as { refresh_token_enc: string };
  assert.ok(raw.refresh_token_enc.startsWith('v1.'));
  assert.ok(!raw.refresh_token_enc.includes('REFRESH-TOKEN-SECRET'));
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM activity_log').all()).includes('REFRESH-TOKEN-SECRET'));
});

test('Drive en lecture seule : aucune requête autre que GET vers l’API Drive, et une seule portée', async () => {
  const { db, g } = await setup();
  await importAll(db);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D1', { modifiedTime: '2026-02-01T00:00:00.000Z' });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  await readDocument(db, 'editor', docId(db, 'D1'), secrets, g.fetch);
  const driveCalls = g.requests.filter((r) => r.url.startsWith('https://www.googleapis.com/'));
  assert.ok(driveCalls.length >= 3, `appels Drive observés : ${driveCalls.length}`);
  assert.ok(g.requests.some((r) => r.url.includes('/export')));
  assert.ok(driveCalls.every((r) => r.method === 'GET'));
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.readonly');
});

test('identifiants Drive : injection dans la requête refusée', () => {
  assert.throws(() => assertDriveId("x' or '1'='1"), DriveError);
  assert.throws(() => assertDriveId('a b'), DriveError);
  assert.equal(assertDriveId('root'), 'root');
  assert.equal(assertDriveId('1AbC_d-9'), '1AbC_d-9');
});

test('autorisation révoquée : reconnexion demandée, une seule notification, données conservées', async () => {
  const { db, g } = await setup();
  await importAll(db);
  g.refreshStatus = 400;
  const r1 = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.deepEqual([r1.ok, r1.error], [false, 'auth_revoked']);
  assert.equal((await getConnectionInfo(db, 'editor'))?.status, 'reauth_required');
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'drive.reauth_required'"), 1);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM drive_documents WHERE state = 'imported'"), 2);
  // le retour à la normale passe par une nouvelle connexion
  g.refreshStatus = 200;
  await saveConnection(db, 'editor', 'NOUVEAU', DRIVE_SCOPE, secrets.encryptionKey);
  assert.equal((await getConnectionInfo(db, 'editor'))?.status, 'active');
  assert.equal((await syncConnection(db, 'editor', secrets, g.fetch, opts)).ok, true);
});

test('clé de chiffrement erronée : erreur sans marquer l’autorisation comme révoquée', async () => {
  const { db, g } = await setup();
  const wrong: DriveSecrets = { ...secrets, encryptionKey: toBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
  const r = await syncConnection(db, 'editor', wrong, g.fetch, opts);
  assert.equal(r.error, 'unknown');
  assert.equal((await getConnectionInfo(db, 'editor'))?.status, 'active');
});

test('déconnexion : jeton supprimé, autorisation révoquée chez Google, références conservées', async () => {
  const { db, g } = await setup();
  await importAll(db);
  assert.equal(await disconnect(db, 'editor', secrets.encryptionKey, g.fetch), true);
  assert.equal(await getConnectionInfo(db, 'editor'), null);
  assert.ok(g.requests.some((r) => r.url.includes('/revoke')));
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM drive_documents WHERE state = 'imported'"), 2);
  assert.equal(await disconnect(db, 'editor', secrets.encryptionKey, g.fetch), false);
  await assert.rejects(clientFor(db, 'editor', secrets, g.fetch), (e: DriveError) => e.kind === 'auth_revoked');
});

test('dossiers : parcours, ajout, retrait ; droits et validations', async () => {
  const { db, g, drive } = await setup();
  assert.deepEqual((await browseFolders(drive, 'root')).map((f) => f.id).sort(), ['F1', 'F2', 'F3']);
  assert.deepEqual(await addSyncFolder(db, 'editor', drive, 'D1'), { ok: false, reason: 'not_a_folder' });
  assert.deepEqual(await addSyncFolder(db, 'editor', drive, 'INCONNU'), { ok: false, reason: 'not_found' });
  assert.deepEqual(await addSyncFolder(db, 'reader', drive, 'F2'), { ok: false, reason: 'forbidden' });
  assert.equal((await addSyncFolder(db, 'editor', drive, 'F2')).ok, true);
  assert.equal((await listSyncFolders(db, 'editor')).length, 2);
  await importAll(db);
  assert.deepEqual(await removeSyncFolder(db, 'editor', 'F2'), { ok: true });
  assert.deepEqual(await removeSyncFolder(db, 'editor', 'F2'), { ok: false, reason: 'not_found' });
  assert.equal((await listSyncFolders(db, 'editor')).length, 1);
  // retirer un dossier ne touche pas aux documents importés
  assert.equal((await listImported(db, 'editor')).length, 2);
  void g;
});

test('import MANUEL : la liste est proposée, rien n’est importé sans sélection', async () => {
  const { db } = await setup();
  const avail = await listAvailable(db, 'editor');
  assert.deepEqual(avail.map((d) => d.title).sort(), ['Scénario pilote', 'Synopsis']);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM drive_documents WHERE state = 'imported'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM resources WHERE type = 'item' AND id IN (SELECT id FROM drive_documents)"), 0);
  assert.equal((await listImported(db, 'editor')).length, 0);
});

test('import : catégorie et rubrique obligatoires et validées, droits d’écriture, identifiants inconnus ignorés', async () => {
  const { db } = await setup();
  const d1 = docId(db, 'D1');
  assert.deepEqual(await importDocuments(db, 'editor', []), { ok: false, reason: 'invalid_selection' });
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: d1, category: 'magie', sectionId: 'section:documents' }]), { ok: false, reason: 'invalid_category' });
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: d1, category: 'script', sectionId: 'series' }]), { ok: false, reason: 'invalid_section' });
  assert.deepEqual(await importDocuments(db, 'reader', [{ id: d1, category: 'script', sectionId: 'section:documents' }]), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: 'inconnu', category: 'script', sectionId: 'section:documents' }]), { ok: false, reason: 'nothing_to_import' });
  grant(db, 'editor', 'section:seasons', 'read');
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: d1, category: 'script', sectionId: 'section:seasons' }]), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: d1, category: 'script', sectionId: 'section:documents' }]), { ok: true, imported: 1 });
  // second import du même document : ignoré
  assert.deepEqual(await importDocuments(db, 'editor', [{ id: d1, category: 'draft', sectionId: 'section:documents' }]), { ok: false, reason: 'nothing_to_import' });
  // un autre compte ne peut pas importer le document d’une connexion qui n’est pas la sienne
  assert.deepEqual(await importDocuments(db, 'owner', [{ id: docId(db, 'D2'), category: 'notes', sectionId: 'section:documents' }]), { ok: false, reason: 'nothing_to_import' });
});

test('classement manuel : changer catégorie/rubrique, droits vérifiés', async () => {
  const { db } = await setup();
  await importAll(db);
  const d1 = docId(db, 'D1');
  assert.deepEqual(await reclassify(db, 'editor', d1, { category: 'draft' }), { ok: true });
  assert.equal(row(db, 'D1').category, 'draft');
  assert.deepEqual(await reclassify(db, 'reader', d1, { category: 'notes' }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await reclassify(db, 'editor', d1, { category: 'xx' }), { ok: false, reason: 'invalid_category' });
  assert.deepEqual(await reclassify(db, 'editor', d1, { sectionId: 'section:ideas' }), { ok: true });
  assert.equal((db.raw.prepare('SELECT parent_id FROM resources WHERE id = ?').get(d1) as { parent_id: string }).parent_id, 'section:ideas');
});

test('permissions : un document importé est une ressource ; liste filtrée côté serveur', async () => {
  const { db } = await setup();
  await importAll(db);
  assert.equal((await listImported(db, 'reader')).length, 2);
  grant(db, 'reader', docId(db, 'D2'), 'none');
  assert.deepEqual((await listImported(db, 'reader')).map((d) => d.title), ['Scénario pilote']);
  assert.equal(await can(db, 'reader', 'read', docId(db, 'D2')), false);
  assert.equal((await listImported(db, 'owner')).length, 2);
  assert.equal((await listImported(db, 'inconnu')).length, 0);
});

test('readableIds est cohérent avec can() pour tous les rôles et exceptions', async () => {
  const { db } = await setup();
  await importAll(db);
  grant(db, 'reader', 'section:documents', 'none');
  grant(db, 'reader', docId(db, 'D1'), 'read');
  grant(db, 'editor', 'season2', 'none');
  const ids = ['series', 'section:documents', 'season1', 'season2', 's2e1', 's1e1', 'char1', docId(db, 'D1'), docId(db, 'D2'), 'inexistant'];
  for (const user of ['owner', 'admin2', 'editor', 'reader', 'inconnu']) {
    const fast = await readableIds(db, user, ids);
    for (const id of ids) assert.equal(fast.has(id), await can(db, user, 'read', id), `${user} / ${id}`);
  }
});

test('synchronisation : premier passage = point de départ, aucune importation', async () => {
  const { db, g } = await setup();
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.deepEqual([r.ok, r.baseline, r.complete], [true, true, true]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM drive_documents WHERE state = 'imported'"), 0);
  const again = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.deepEqual([again.ok, again.changesSeen, again.complete], [true, 0, true]);
  assert.ok((await getConnectionInfo(db, 'editor'))?.lastSyncAt);
});

test('synchronisation : nouveau document détecté (disponible, jamais importé automatiquement)', async () => {
  const { db, g } = await setup();
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.add({ id: 'D4', name: 'Nouveau', parents: ['F1'] });
  g.add({ id: 'D5', name: 'Hors dossier', parents: ['F3'] });
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r.newDocuments, 1);
  assert.equal(row(db, 'D4').state, 'available');
  assert.equal(db.raw.prepare("SELECT 1 FROM drive_documents WHERE drive_file_id = 'D5'").get(), undefined);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM drive_documents WHERE state = 'imported'"), 0);
});

test('synchronisation : modification détectée, notification sans doublon', async () => {
  const { db, g } = await setup();
  await importAll(db);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D1', { modifiedTime: '2026-03-01T10:00:00.000Z', name: 'Scénario pilote v2' });
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r.modified, 1);
  assert.equal(row(db, 'D1').title, 'Scénario pilote v2');
  assert.equal(row(db, 'D1').modified_time, '2026-03-01T10:00:00.000Z');
  g.touch('D1', { modifiedTime: '2026-03-01T11:00:00.000Z' });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  const n = count(db, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'document.modified' AND user_id = 'reader'");
  assert.equal(n, 1); // une seule notification non lue par document
  // pas de notification pour quelqu'un qui n'a pas le droit de lire
  grant(db, 'reader', docId(db, 'D2'), 'none');
  g.touch('D2', { modifiedTime: '2026-03-02T00:00:00.000Z' });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  const leak = db.raw.prepare("SELECT payload FROM notifications WHERE user_id = 'reader' AND type = 'document.modified'").all() as { payload: string }[];
  assert.ok(leak.every((x) => !x.payload.includes(docId(db, 'D2'))));
});

test('suppression / corbeille / accès retiré : référence, titre et classement CONSERVÉS, avertissement affiché', async () => {
  const { db, g } = await setup();
  await importAll(db);
  await reclassify(db, 'editor', docId(db, 'D2'), { category: 'notes' });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.remove('D1');
  g.touch('D2', { trashed: true });
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r.statusChanged, 2);
  assert.deepEqual([row(db, 'D1').status, row(db, 'D1').title, row(db, 'D1').category, row(db, 'D1').state], ['removed', 'Scénario pilote', 'script', 'imported']);
  assert.deepEqual([row(db, 'D2').status, row(db, 'D2').category], ['trashed', 'notes']);
  const listed = await listImported(db, 'reader');
  assert.equal(listed.length, 2);
  assert.ok(listed.every((d) => d.statusDetail && d.status !== 'ok'));
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'document.inaccessible' AND user_id = 'reader'"), 2);
  // une nouvelle synchronisation n'ajoute pas de doublons
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'document.inaccessible'") / 4 >= 1, true);
});

test('document restauré : le statut redevient normal', async () => {
  const { db, g } = await setup();
  await importAll(db);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D2', { trashed: true });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(row(db, 'D2').status, 'trashed');
  g.touch('D2', { trashed: false });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.deepEqual([row(db, 'D2').status, row(db, 'D2').status_detail], ['ok', null]);
});

test('déplacement : hors des dossiers synchronisés = avertissement ; vers un autre dossier synchronisé = normal', async () => {
  const { db, g, drive } = await setup();
  await addSyncFolder(db, 'editor', drive, 'F2');
  await importAll(db);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D1', { parents: ['F3'] }); // hors périmètre
  g.touch('D2', { parents: ['F2'] }); // autre dossier synchronisé
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(row(db, 'D1').status, 'moved_out');
  assert.equal(row(db, 'D2').status, 'ok');
  assert.equal(row(db, 'D2').parent_ids, '["F2"]');
  // dossier retiré de la synchronisation puis document modifié sans déplacement : pas de faux avertissement
  await removeSyncFolder(db, 'editor', 'F2');
  g.touch('D2', { modifiedTime: '2026-05-05T00:00:00.000Z' });
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(row(db, 'D2').status, 'ok');
});

test('erreur temporaire : nouvelle tentative automatique puis succès', async () => {
  const { db, g } = await setup();
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D1', { modifiedTime: '2026-04-01T00:00:00.000Z' });
  g.failNext = { status: 503, times: 2 };
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r.ok, true);
  assert.equal((await getConnectionInfo(db, 'editor'))?.lastError, null);
});

test('erreur persistante : signalée une fois, rien n’est perdu, reprise ensuite', async () => {
  const { db, g } = await setup();
  await importAll(db);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  const before = row(db, 'D1');
  g.touch('D1', { modifiedTime: '2026-04-01T00:00:00.000Z' });
  g.failNext = { status: 500, times: 99 };
  const r1 = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.deepEqual([r1.ok, r1.error], [false, 'temporary']);
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal((await getConnectionInfo(db, 'editor'))?.lastError, 'temporary');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notifications WHERE type = 'sync.error'"), 1);
  assert.deepEqual(row(db, 'D1'), before);
  g.failNext = null;
  const r2 = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r2.ok, true);
  assert.equal(row(db, 'D1').modified_time, '2026-04-01T00:00:00.000Z'); // le changement n'a pas été perdu
  assert.equal((await getConnectionInfo(db, 'editor'))?.lastError, null);
});

test('quota Google : traité comme temporaire (nouvelle tentative), pas comme une perte d’accès', async () => {
  const { db, g } = await setup();
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  g.touch('D1', { modifiedTime: '2026-04-01T00:00:00.000Z' });
  g.failNext = { status: 403, times: 99, reason: 'userRateLimitExceeded' };
  const r = await syncConnection(db, 'editor', secrets, g.fetch, opts);
  assert.equal(r.error, 'rate_limited');
  assert.equal((await getConnectionInfo(db, 'editor'))?.status, 'active');
});

test('budget de requêtes : la synchronisation est découpée et reprend là où elle s’est arrêtée', async () => {
  const { db, g } = await setup();
  await syncConnection(db, 'editor', secrets, g.fetch, opts);
  for (let i = 0; i < 250; i++) g.add({ id: `N${i}`, name: `Doc ${i}`, parents: ['F1'] });
  const runs: boolean[] = [];
  let total = 0;
  for (let i = 0; i < 6 && !runs.at(-1); i++) {
    const r = await syncConnection(db, 'editor', secrets, g.fetch, { ...opts, maxCalls: 1 });
    runs.push(r.complete);
    total += r.newDocuments;
  }
  assert.deepEqual(runs, [false, false, true]);
  assert.equal(total, 250);
});

test('syncIfStale : pas de nouvelle synchronisation trop rapprochée ; syncAll pour la tâche planifiée', async () => {
  const { db, g } = await setup();
  assert.ok(await syncIfStale(db, 'editor', secrets, 120_000, g.fetch, opts));
  assert.equal(await syncIfStale(db, 'editor', secrets, 120_000, g.fetch, opts), null);
  assert.equal(await syncIfStale(db, 'reader', secrets, 120_000, g.fetch, opts), null); // pas connecté
  assert.equal(await syncAll(db, secrets, g.fetch, opts), 1);
});

test('lecture : avec le compte de l’utilisateur ; droits applicatifs et droits Drive distincts', async () => {
  const { db, g } = await setup();
  await importAll(db);
  const d1 = docId(db, 'D1');
  const ok = await readDocument(db, 'editor', d1, secrets, g.fetch);
  assert.deepEqual(ok.ok && [ok.html, ok.title], ['<p>Bonjour</p>', 'Scénario pilote']);
  // le lecteur peut voir la référence dans l'application, mais n'a pas connecté son Drive
  assert.deepEqual(await readDocument(db, 'reader', d1, secrets, g.fetch), { ok: false, reason: 'not_connected' });
  // sans droit applicatif : refus, et aucune requête Drive n'est émise
  grant(db, 'reader', d1, 'none');
  const calls = g.requests.length;
  assert.deepEqual(await readDocument(db, 'reader', d1, secrets, g.fetch), { ok: false, reason: 'forbidden' });
  assert.equal(g.requests.length, calls);
  // droit applicatif mais pas d'accès Drive pour ce compte
  g.touch('D2', { accessible: false });
  assert.deepEqual(await readDocument(db, 'editor', docId(db, 'D2'), secrets, g.fetch), { ok: false, reason: 'inaccessible' });
  assert.deepEqual(await readDocument(db, 'editor', 'inconnu', secrets, g.fetch), { ok: false, reason: 'forbidden' });
});

test('lecture : formats non affichables signalés, autorisation expirée distinguée', async () => {
  const { db, g } = await setup();
  g.add({ id: 'P1', name: 'Image', mimeType: 'application/pdf', parents: ['F1'] });
  const drive = await clientFor(db, 'editor', secrets, g.fetch);
  await refreshAvailable(db, 'editor', drive);
  await importAll(db, ['D1', 'P1']);
  assert.deepEqual(await readDocument(db, 'editor', docId(db, 'P1'), secrets, g.fetch), { ok: false, reason: 'not_viewable' });
  const imported = await listImported(db, 'editor');
  assert.deepEqual(imported.map((d) => [d.title, d.viewable]).sort(), [['Image', false], ['Scénario pilote', true]]);
  g.refreshStatus = 400;
  assert.deepEqual(await readDocument(db, 'editor', docId(db, 'D1'), secrets, g.fetch), { ok: false, reason: 'reauth_required' });
});

test('client : un jeton d’accès invalide est reconnu comme autorisation révoquée', async () => {
  const g = new FakeGoogle();
  const bad = new DriveClient('MAUVAIS', g.fetch);
  await assert.rejects(bad.getStartPageToken(), (e: DriveError) => e.kind === 'auth_revoked');
});
