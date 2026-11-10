import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../src/lib/permissions.ts';
import { setGrant } from '../src/lib/members.ts';
import { grant, makeDb, seed } from './helpers/db.ts';

function setup() {
  const db = makeDb();
  seed(db);
  return db;
}

test('lecteur : lit tout, n’écrit rien', async () => {
  const db = setup();
  assert.equal(await can(db, 'reader', 'read', 's1e1'), true);
  assert.equal(await can(db, 'reader', 'write', 's1e1'), false);
  assert.equal(await can(db, 'reader', 'admin', 'series'), false);
});

test('éditeur : lit et écrit, mais pas d’action admin', async () => {
  const db = setup();
  assert.equal(await can(db, 'editor', 'write', 's2e1'), true);
  assert.equal(await can(db, 'editor', 'admin', 'series'), false);
});

test('administrateur : tout, et aucune exception ne le restreint', async () => {
  const db = setup();
  grant(db, 'admin2', 'season1', 'none');
  assert.equal(await can(db, 'admin2', 'write', 's1e1'), true);
  assert.equal(await can(db, 'admin2', 'admin', 'series'), true);
});

test('exemple du cahier des charges : lecture partout, écriture seulement saison 2 et ses épisodes', async () => {
  const db = setup();
  grant(db, 'reader', 'season2', 'write');
  assert.equal(await can(db, 'reader', 'write', 'season2'), true);
  assert.equal(await can(db, 'reader', 'write', 's2e1'), true);
  assert.equal(await can(db, 'reader', 'write', 's2e2'), true);
  assert.equal(await can(db, 'reader', 'write', 'season1'), false);
  assert.equal(await can(db, 'reader', 'write', 's1e1'), false);
  assert.equal(await can(db, 'reader', 'write', 'char1'), false);
  assert.equal(await can(db, 'reader', 'read', 's1e1'), true);
});

test('exception « none » : un éditeur n’accède pas à la saison 1', async () => {
  const db = setup();
  grant(db, 'editor', 'season1', 'none');
  assert.equal(await can(db, 'editor', 'read', 's1e1'), false);
  assert.equal(await can(db, 'editor', 'write', 's1e1'), false);
  assert.equal(await can(db, 'editor', 'write', 's2e1'), true);
});

test('exception la plus spécifique l’emporte', async () => {
  const db = setup();
  grant(db, 'editor', 'season2', 'read');
  grant(db, 'editor', 's2e2', 'write');
  assert.equal(await can(db, 'editor', 'write', 's2e1'), false);
  assert.equal(await can(db, 'editor', 'read', 's2e1'), true);
  assert.equal(await can(db, 'editor', 'write', 's2e2'), true);
});

test('refus par défaut : inconnu, ressource inconnue, membre retiré', async () => {
  const db = setup();
  assert.equal(await can(db, 'personne', 'read', 'series'), false);
  assert.equal(await can(db, 'reader', 'read', 'inexistant'), false);
  db.raw.prepare("UPDATE memberships SET removed_at = '2026-02-01T00:00:00.000Z' WHERE user_id = 'editor'").run();
  assert.equal(await can(db, 'editor', 'read', 'series'), false);
});

test('setGrant : réservé aux administrateurs, pas applicable aux administrateurs', async () => {
  const db = setup();
  assert.deepEqual(await setGrant(db, 'editor', 'reader', 'season2', 'write'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await setGrant(db, 'owner', 'admin2', 'season2', 'none'), { ok: false, reason: 'admin_not_restrictable' });
  assert.deepEqual(await setGrant(db, 'owner', 'reader', 'inexistant', 'write'), { ok: false, reason: 'resource_not_found' });
  assert.deepEqual(await setGrant(db, 'owner', 'reader', 'season2', 'write'), { ok: true });
  assert.equal(await can(db, 'reader', 'write', 's2e1'), true);
  // mise à jour puis suppression de l'exception
  assert.deepEqual(await setGrant(db, 'owner', 'reader', 'season2', 'read'), { ok: true });
  assert.equal(await can(db, 'reader', 'write', 's2e1'), false);
  assert.deepEqual(await setGrant(db, 'owner', 'reader', 'season2', null), { ok: true });
  const log = db.raw.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'permission.changed'").get() as { n: number };
  assert.equal(log.n, 3);
});
