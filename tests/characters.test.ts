// Tests des personnages, images, relations et apparitions (données fictives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAppearance, addRelation, archiveCharacter, createCharacter, getCharacter, listCharacters, removeAppearance, removeCharacterPhoto, removeRelation, setCharacterPhoto, updateCharacter, updateRelation } from '../src/lib/characters.ts';
import { IMAGE_REFUSE_BYTES, MAX_IMAGE_BYTES, fromB64, getImage, imageUsage, sniffImage, toB64 } from '../src/lib/images.ts';
import { createSeason, getEpisode } from '../src/lib/seasons.ts';
import { getDashboard } from '../src/lib/dashboard.ts';
import { can } from '../src/lib/permissions.ts';
import { grant, makeDb, seed } from './helpers/db.ts';

const db0 = () => { const db = makeDb(); seed(db); return db; };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const mk = async (db: ReturnType<typeof makeDb>, first: string, last = '') => {
  const r = await createCharacter(db, 'editor', { firstName: first, lastName: last });
  assert.ok(r.ok);
  return r.ok ? r.id : '';
};

test('création : nom obligatoire, champs validés, droits', async () => {
  const db = db0();
  assert.deepEqual(await createCharacter(db, 'editor', {}), { ok: false, reason: 'name_required' });
  assert.deepEqual(await createCharacter(db, 'editor', { firstName: 'x'.repeat(101) }), { ok: false, reason: 'invalid_name' });
  assert.deepEqual(await createCharacter(db, 'editor', { firstName: 'A', age: 'y'.repeat(41) }), { ok: false, reason: 'invalid_age' });
  assert.deepEqual(await createCharacter(db, 'editor', { firstName: 'A', history: 'z'.repeat(10001) }), { ok: false, reason: 'invalid_text' });
  assert.deepEqual(await createCharacter(db, 'reader', { firstName: 'A' }), { ok: false, reason: 'forbidden' });
  const id = await mk(db, 'Alice', 'Martin');
  assert.equal(await can(db, 'reader', 'read', id), true);
  assert.equal(await can(db, 'reader', 'write', id), false);
  assert.deepEqual(await updateCharacter(db, 'editor', id, { age: 'environ 40 ans', personality: 'Têtue', qualities: 'Loyale' }), { ok: true });
  const c = await getCharacter(db, 'reader', id);
  assert.deepEqual([c?.name, c?.age, c?.personality, c?.qualities, c?.canWrite], ['Alice Martin', 'environ 40 ans', 'Têtue', 'Loyale', false]);
  assert.deepEqual(await updateCharacter(db, 'editor', id, { firstName: '', lastName: '' }), { ok: false, reason: 'name_required' });
  assert.deepEqual(await updateCharacter(db, 'reader', id, { age: '1' }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await updateCharacter(db, 'editor', id, {}), { ok: false, reason: 'nothing_to_update' });
});

test('liste : ordre alphabétique, filtrée par permissions, rubrique masquée = refus', async () => {
  const db = db0();
  const b = await mk(db, 'Bruno'); const a = await mk(db, 'Alice'); await mk(db, 'Chloé');
  assert.deepEqual((await listCharacters(db, 'reader'))?.map((c) => c.name), ['Alice', 'Bruno', 'Chloé']);
  grant(db, 'reader', b, 'none');
  assert.deepEqual((await listCharacters(db, 'reader'))?.map((c) => c.name), ['Alice', 'Chloé']);
  assert.equal(await getCharacter(db, 'reader', b), null);
  void a;
  grant(db, 'reader', 'section:characters', 'none');
  assert.equal(await listCharacters(db, 'reader'), null);
  assert.equal((await listCharacters(db, 'owner'))?.length, 3);
});

test('images : signature vérifiée, taille limitée, formats dangereux refusés', async () => {
  const db = db0();
  const id = await mk(db, 'Alice');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')), null);
  assert.equal(sniffImage(new TextEncoder().encode('<html><script>alert(1)</script></html>')), null);
  assert.deepEqual(await setCharacterPhoto(db, 'editor', id, new TextEncoder().encode('<svg onload=alert(1)></svg>.......')), { ok: false, reason: 'invalid_image' });
  assert.deepEqual(await setCharacterPhoto(db, 'editor', id, new Uint8Array(0)), { ok: false, reason: 'invalid_image' });
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1); big.set(JPEG);
  assert.deepEqual(await setCharacterPhoto(db, 'editor', id, big), { ok: false, reason: 'image_too_large' });
  assert.deepEqual(await setCharacterPhoto(db, 'reader', id, JPEG), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await setCharacterPhoto(db, 'editor', 'inconnu', JPEG), { ok: false, reason: 'forbidden' });
  const ok = await setCharacterPhoto(db, 'editor', id, JPEG);
  assert.ok(ok.ok);
  assert.deepEqual(fromB64(toB64(JPEG)), JPEG);
});

test('image : lisible seulement avec le droit de lecture de la fiche ; remplacée = plus servie mais conservée', async () => {
  const db = db0();
  const id = await mk(db, 'Alice');
  const first = await setCharacterPhoto(db, 'editor', id, JPEG);
  assert.ok(first.ok);
  const img1 = first.ok ? first.imageId : '';
  assert.equal((await getImage(db, 'reader', img1))?.mime, 'image/jpeg');
  assert.equal(await getImage(db, 'inconnu', img1), null);
  grant(db, 'reader', id, 'none');
  assert.equal(await getImage(db, 'reader', img1), null);
  assert.equal((await getImage(db, 'editor', img1))?.bytes.length, JPEG.length);
  const second = await setCharacterPhoto(db, 'editor', id, PNG);
  assert.ok(second.ok);
  assert.equal(await getImage(db, 'editor', img1), null); // ancienne image : plus servie…
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM images').get()?.n, 2); // …mais conservée
  assert.equal((await getCharacter(db, 'editor', id))?.photoImageId, second.ok ? second.imageId : '');
  assert.deepEqual(await removeCharacterPhoto(db, 'editor', id), { ok: true });
  assert.equal((await getCharacter(db, 'editor', id))?.photoImageId, null);
  assert.deepEqual(await removeCharacterPhoto(db, 'editor', id), { ok: false, reason: 'not_found' });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM images').get()?.n, 2);
});

test('stockage : avertissement puis refus avant la limite gratuite', async () => {
  const db = db0();
  const id = await mk(db, 'Alice');
  assert.deepEqual(await imageUsage(db), { bytes: 0, warn: false, full: false });
  db.raw.prepare("INSERT INTO images (id, resource_id, mime, size_bytes, data_b64, created_at, replaced_at) VALUES ('x', ?, 'image/png', ?, '', 'now', 'now')").run(id, 360_000_000);
  assert.deepEqual(await imageUsage(db), { bytes: 360_000_000, warn: true, full: false });
  assert.equal((await setCharacterPhoto(db, 'editor', id, JPEG)).ok, true);
  db.raw.prepare("UPDATE images SET size_bytes = ? WHERE id = 'x'").run(IMAGE_REFUSE_BYTES);
  assert.deepEqual(await setCharacterPhoto(db, 'editor', id, PNG), { ok: false, reason: 'storage_full' });
});

test('relations : visibles depuis les deux fiches, validées, droits sur les deux fiches', async () => {
  const db = db0();
  const a = await mk(db, 'Alice'); const b = await mk(db, 'Bruno'); const c = await mk(db, 'Chloé');
  assert.deepEqual(await addRelation(db, 'editor', a, a, 'family', ''), { ok: false, reason: 'same_character' });
  assert.deepEqual(await addRelation(db, 'editor', a, b, 'ennemi', ''), { ok: false, reason: 'invalid_kind' });
  assert.deepEqual(await addRelation(db, 'reader', a, b, 'family', ''), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await addRelation(db, 'editor', a, 'inconnu', 'family', ''), { ok: false, reason: 'forbidden' });
  const r = await addRelation(db, 'editor', a, b, 'family', 'Frère et sœur');
  assert.ok(r.ok);
  assert.deepEqual(await addRelation(db, 'editor', b, a, 'family', 'doublon'), { ok: false, reason: 'already_exists' });
  assert.ok((await addRelation(db, 'editor', b, a, 'rivalry', 'Aussi')).ok); // autre type autorisé
  const fromA = await getCharacter(db, 'reader', a);
  const fromB = await getCharacter(db, 'reader', b);
  assert.deepEqual(fromA?.relations.map((x) => [x.otherName, x.kind]), [['Bruno', 'family'], ['Bruno', 'rivalry']]);
  assert.deepEqual(fromB?.relations.map((x) => [x.otherName, x.kind]), [['Alice', 'family'], ['Alice', 'rivalry']]);
  assert.deepEqual((await getCharacter(db, 'reader', c))?.relations, []);
  // un personnage interdit au lecteur ne fuit pas dans les relations
  grant(db, 'reader', b, 'none');
  assert.deepEqual((await getCharacter(db, 'reader', a))?.relations, []);
  // écriture exigée sur les deux fiches
  grant(db, 'editor', b, 'read');
  assert.deepEqual(await addRelation(db, 'editor', a, b, 'colleagues', ''), { ok: false, reason: 'forbidden' });
  assert.equal((await addRelation(db, 'editor', a, c, 'friendship', '')).ok, true);
});

test('relations : modification et suppression du lien seulement', async () => {
  const db = db0();
  const a = await mk(db, 'Alice'); const b = await mk(db, 'Bruno');
  const r = await addRelation(db, 'editor', a, b, 'friendship', 'Amis');
  const rid = r.ok ? r.id : '';
  assert.deepEqual(await updateRelation(db, 'editor', rid, { kind: 'couple', description: 'Ensemble' }), { ok: true });
  assert.deepEqual((await getCharacter(db, 'editor', a))?.relations.map((x) => [x.kind, x.description]), [['couple', 'Ensemble']]);
  assert.deepEqual(await updateRelation(db, 'reader', rid, { kind: 'family' }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await updateRelation(db, 'editor', rid, { kind: 'zzz' }), { ok: false, reason: 'invalid_kind' });
  assert.deepEqual(await removeRelation(db, 'reader', rid), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await removeRelation(db, 'editor', rid), { ok: true });
  assert.deepEqual(await removeRelation(db, 'editor', rid), { ok: false, reason: 'not_found' });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM characters').get()?.n, 2);
});

test('apparitions manuelles : depuis le personnage ou l’épisode, filtrées, sans doublon', async () => {
  const db = db0();
  const a = await mk(db, 'Alice'); const b = await mk(db, 'Bruno');
  const s = await createSeason(db, 'editor', { episodeCount: 2 });
  assert.ok(s.ok);
  const [e1, e2] = s.ok ? s.episodeIds : [];
  assert.deepEqual(await addAppearance(db, 'editor', a, e1), { ok: true });
  assert.deepEqual(await addAppearance(db, 'editor', a, e1), { ok: false, reason: 'already_exists' });
  assert.deepEqual(await addAppearance(db, 'editor', b, e1), { ok: true });
  assert.deepEqual(await addAppearance(db, 'editor', a, e2), { ok: true });
  assert.deepEqual(await addAppearance(db, 'reader', b, e2), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await addAppearance(db, 'editor', a, 'inconnu'), { ok: false, reason: 'forbidden' });
  assert.deepEqual((await getCharacter(db, 'reader', a))?.appearances.map((x) => x.code), ['S01E01', 'S01E02']);
  assert.deepEqual((await getEpisode(db, 'reader', e1))?.characters.map((x) => x.name), ['Alice', 'Bruno']);
  // exception : épisode masqué pour le lecteur => absent de l'historique du personnage
  grant(db, 'reader', e2, 'none');
  assert.deepEqual((await getCharacter(db, 'reader', a))?.appearances.map((x) => x.code), ['S01E01']);
  // exception : personnage masqué => absent de la liste des personnages présents
  grant(db, 'reader', b, 'none');
  assert.deepEqual((await getEpisode(db, 'reader', e1))?.characters.map((x) => x.name), ['Alice']);
  // écriture sur l'épisode seulement : possible, à condition de pouvoir lire le personnage
  grant(db, 'reader', 'section:seasons', 'write');
  db.raw.prepare("UPDATE grants SET level = 'read' WHERE user_id = 'reader' AND resource_id = ?").run(b);
  assert.deepEqual(await addAppearance(db, 'reader', b, e2), { ok: false, reason: 'forbidden' }); // e2 reste masqué
  assert.deepEqual(await removeAppearance(db, 'editor', b, e1), { ok: true });
  assert.deepEqual(await removeAppearance(db, 'editor', b, e1), { ok: false, reason: 'not_found' });
  assert.deepEqual(await removeAppearance(db, 'reader', a, e1), { ok: true }); // écriture sur l'épisode e1 (rubrique Saisons)
});

test('archivage d’un personnage : disparaît des listes et relations, données conservées', async () => {
  const db = db0();
  const a = await mk(db, 'Alice'); const b = await mk(db, 'Bruno');
  await addRelation(db, 'editor', a, b, 'friendship', '');
  const s = await createSeason(db, 'editor', { episodeCount: 1 });
  await addAppearance(db, 'editor', b, s.ok ? s.episodeIds[0] : '');
  assert.deepEqual(await archiveCharacter(db, 'reader', b), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await archiveCharacter(db, 'editor', b), { ok: true });
  assert.deepEqual(await archiveCharacter(db, 'editor', b), { ok: false, reason: 'not_found' });
  assert.deepEqual((await listCharacters(db, 'editor'))?.map((c) => c.name), ['Alice']);
  assert.deepEqual((await getCharacter(db, 'editor', a))?.relations, []);
  assert.deepEqual((await getEpisode(db, 'editor', s.ok ? s.episodeIds[0] : ''))?.characters, []);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM characters').get()?.n, 2);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM character_relations').get()?.n, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM character_appearances').get()?.n, 1);
});

test('journal : aucune donnée de fiche ni image dans les entrées', async () => {
  const db = db0();
  const id = await mk(db, 'Secret', 'Fictif');
  await updateCharacter(db, 'editor', id, { history: 'Passé confidentiel' });
  await setCharacterPhoto(db, 'editor', id, JPEG);
  const log = JSON.stringify(db.raw.prepare("SELECT * FROM activity_log WHERE action LIKE 'character.%'").all());
  assert.ok(log.includes('character.created') && log.includes('character.photo_changed'));
  assert.ok(!log.includes('confidentiel') && !log.includes('Secret') && !log.includes(toB64(JPEG)));
});

test('tableau de bord : nombre de personnages réel, filtré par permissions', async () => {
  const db = db0();
  const a = await mk(db, 'Alice'); await mk(db, 'Bruno');
  assert.equal((await getDashboard(db, 'owner'))?.characters, 2);
  grant(db, 'reader', a, 'none');
  assert.equal((await getDashboard(db, 'reader'))?.characters, 1);
});
