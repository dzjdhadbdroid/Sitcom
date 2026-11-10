import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeLogin, type GoogleProfile } from '../src/lib/auth.ts';
import { cancelInvitation, createInvitation, listPendingInvitations } from '../src/lib/invitations.ts';
import { removeMember, setRole } from '../src/lib/members.ts';
import { createSession, getSessionUser, revokeSession } from '../src/lib/sessions.ts';
import { sha256Hex } from '../src/lib/crypto.ts';
import { makeDb, seed } from './helpers/db.ts';

const OWNER = 'proprio@test.example';
const profile = (email: string, sub = `sub-${email}`, extra: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub,
  email,
  emailVerified: true,
  name: 'Test',
  ...extra,
});
const login = (db: ReturnType<typeof makeDb>, p: GoogleProfile, inviteToken?: string) =>
  authorizeLogin(db, { profile: p, inviteToken, ownerEmail: OWNER });

test('propriétaire initial : créé une seule fois, protégé', async () => {
  const db = makeDb();
  const r = await login(db, profile(OWNER));
  assert.equal(r.ok, true);
  const m = db.raw.prepare('SELECT role, is_owner FROM memberships').get() as { role: string; is_owner: number };
  assert.deepEqual({ ...m }, { role: 'admin', is_owner: 1 });
  // un autre compte Google avec la même adresse est refusé
  const again = await login(db, profile(OWNER, 'autre-sub'));
  assert.deepEqual(again, { ok: false, reason: 'google_account_mismatch' });
  // reconnexion normale
  assert.equal((await login(db, profile(OWNER))).ok, true);
});

test('inscription libre impossible', async () => {
  const db = makeDb();
  await login(db, profile(OWNER));
  assert.deepEqual(await login(db, profile('inconnu@test.example')), { ok: false, reason: 'not_invited' });
  assert.deepEqual(await login(db, profile('inconnu@test.example'), 'jeton-invente'), { ok: false, reason: 'not_invited' });
});

test('e-mail non vérifié refusé', async () => {
  const db = makeDb();
  assert.deepEqual(await login(db, profile(OWNER, 'x', { emailVerified: false })), { ok: false, reason: 'email_not_verified' });
});

test('invitation : parcours complet, jeton non stocké, usage unique', async () => {
  const db = makeDb();
  seed(db);
  const inv = await createInvitation(db, 'owner', { email: ' Nouvelle@Test.example ', role: 'editor' });
  assert.ok(inv.ok);
  if (!inv.ok) return;
  const stored = db.raw.prepare('SELECT email, token_hash FROM invitations').get() as { email: string; token_hash: string };
  assert.equal(stored.email, 'nouvelle@test.example');
  assert.equal(stored.token_hash, await sha256Hex(inv.token));
  assert.notEqual(stored.token_hash, inv.token);

  const r = await login(db, profile('nouvelle@test.example'), inv.token);
  assert.equal(r.ok, true);
  const m = db.raw.prepare("SELECT role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'nouvelle@test.example'").get() as { role: string };
  assert.equal(m.role, 'editor');
  // notification envoyée aux administrateurs (owner + admin2)
  const n = db.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'invitation.accepted'").get() as { n: number };
  assert.equal(n.n, 2);
  // le jeton ne peut pas servir une seconde fois pour une autre personne
  assert.deepEqual(await login(db, profile('autre@test.example'), inv.token), { ok: false, reason: 'not_invited' });
});

test('invitation : adresse différente refusée, jeton nécessaire', async () => {
  const db = makeDb();
  seed(db);
  const inv = await createInvitation(db, 'owner', { email: 'a@test.example', role: 'reader' });
  assert.ok(inv.ok);
  if (!inv.ok) return;
  assert.deepEqual(await login(db, profile('b@test.example'), inv.token), { ok: false, reason: 'not_invited' });
  assert.deepEqual(await login(db, profile('a@test.example')), { ok: false, reason: 'not_invited' });
});

test('invitation : expirée ou annulée refusée', async () => {
  const db = makeDb();
  seed(db);
  const a = await createInvitation(db, 'owner', { email: 'a@test.example', role: 'reader' });
  const b = await createInvitation(db, 'owner', { email: 'b@test.example', role: 'reader' });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  db.raw.prepare("UPDATE invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE email = 'a@test.example'").run();
  assert.deepEqual(await login(db, profile('a@test.example'), a.token), { ok: false, reason: 'invitation_unusable' });
  assert.deepEqual(await cancelInvitation(db, 'owner', b.invitationId), { ok: true });
  assert.deepEqual(await login(db, profile('b@test.example'), b.token), { ok: false, reason: 'invitation_unusable' });
});

test('invitation : réutilisation après acceptation refusée', async () => {
  const db = makeDb();
  seed(db);
  const inv = await createInvitation(db, 'owner', { email: 'a@test.example', role: 'reader' });
  assert.ok(inv.ok);
  if (!inv.ok) return;
  assert.equal((await login(db, profile('a@test.example'), inv.token)).ok, true);
  // retiré puis tentative avec le même jeton : l'invitation est consommée
  const uid = (db.raw.prepare("SELECT id FROM users WHERE email = 'a@test.example'").get() as { id: string }).id;
  await removeMember(db, 'owner', uid);
  assert.deepEqual(await login(db, profile('a@test.example'), inv.token), { ok: false, reason: 'invitation_unusable' });
});

test('invitation : seuls les administrateurs invitent ; doublons et membres existants refusés', async () => {
  const db = makeDb();
  seed(db);
  assert.deepEqual(await createInvitation(db, 'editor', { email: 'a@test.example', role: 'reader' }), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await createInvitation(db, 'owner', { email: 'pas-un-mail', role: 'reader' }), { ok: false, reason: 'invalid_email' });
  assert.deepEqual(await createInvitation(db, 'owner', { email: 'a@test.example', role: 'roi' as never }), { ok: false, reason: 'invalid_role' });
  assert.deepEqual(await createInvitation(db, 'owner', { email: 'reader@test.example', role: 'reader' }), { ok: false, reason: 'already_member' });
  assert.equal((await createInvitation(db, 'owner', { email: 'a@test.example', role: 'reader' })).ok, true);
  assert.deepEqual(await createInvitation(db, 'owner', { email: 'A@test.example', role: 'editor' }), { ok: false, reason: 'already_pending' });
  assert.equal((await listPendingInvitations(db, 'owner'))?.length, 1);
  assert.equal(await listPendingInvitations(db, 'reader'), null);
});

test('membre retiré : connexion refusée, sessions révoquées, réinvitation possible', async () => {
  const db = makeDb();
  seed(db);
  const s = await createSession(db, 'editor');
  assert.equal((await getSessionUser(db, s.token))?.userId, 'editor');
  assert.deepEqual(await removeMember(db, 'owner', 'editor'), { ok: true });
  assert.equal(await getSessionUser(db, s.token), null);
  assert.deepEqual(await login(db, profile('editor@test.example', 'sub-editor')), { ok: false, reason: 'not_invited' });
  const inv = await createInvitation(db, 'owner', { email: 'editor@test.example', role: 'reader' });
  assert.ok(inv.ok);
  if (!inv.ok) return;
  assert.equal((await login(db, profile('editor@test.example', 'sub-editor'), inv.token)).ok, true);
  const m = db.raw.prepare("SELECT role, removed_at FROM memberships WHERE user_id = 'editor'").get() as { role: string; removed_at: string | null };
  assert.deepEqual({ ...m }, { role: 'reader', removed_at: null });
});

test('propriétaire protégé contre toute rétrogradation ou retrait', async () => {
  const db = makeDb();
  seed(db);
  assert.deepEqual(await setRole(db, 'admin2', 'owner', 'reader'), { ok: false, reason: 'owner_protected' });
  assert.deepEqual(await removeMember(db, 'admin2', 'owner'), { ok: false, reason: 'owner_protected' });
  assert.deepEqual(await removeMember(db, 'owner', 'owner'), { ok: false, reason: 'owner_protected' });
  assert.deepEqual(await setRole(db, 'editor', 'reader', 'admin'), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await setRole(db, 'owner', 'reader', 'editor'), { ok: true });
  assert.deepEqual(await removeMember(db, 'admin2', 'admin2'), { ok: false, reason: 'cannot_remove_self' });
});

test('base : un seul propriétaire possible', () => {
  const db = makeDb();
  seed(db);
  db.raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u9', 'u9@test.example', 'x')").run();
  assert.throws(() => db.raw.prepare("INSERT INTO memberships (user_id, role, is_owner, joined_at) VALUES ('u9', 'admin', 1, 'x')").run());
});

test('sessions : expirée ou révoquée invalide', async () => {
  const db = makeDb();
  seed(db);
  const s = await createSession(db, 'reader');
  assert.equal((await getSessionUser(db, s.token))?.role, 'reader');
  assert.equal(await getSessionUser(db, 'jeton-inconnu'), null);
  assert.equal(await getSessionUser(db, undefined), null);
  const stored = db.raw.prepare('SELECT id FROM sessions').get() as { id: string };
  assert.notEqual(stored.id, s.token); // le jeton n'est pas stocké en clair
  db.raw.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal(await getSessionUser(db, s.token), null);
  const s2 = await createSession(db, 'reader');
  await revokeSession(db, s2.token);
  assert.equal(await getSessionUser(db, s2.token), null);
});
