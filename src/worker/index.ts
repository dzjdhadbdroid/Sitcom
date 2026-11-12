import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { authorizeLogin, type GoogleProfile } from '../lib/auth.ts';
import { fromBase64Url, randomToken, toBase64Url } from '../lib/crypto.ts';
import { cancelInvitation, createInvitation, listPendingInvitations } from '../lib/invitations.ts';
import { getDashboard } from '../lib/dashboard.ts';
import { removeMember, setGrant, setRole } from '../lib/members.ts';
import { getSeries, updateSeries } from '../lib/series.ts';
import { createSession, getSessionUser, revokeSession, SESSION_TTL_DAYS, type SessionUser } from '../lib/sessions.ts';
import type { DB } from '../lib/db.ts';
import { DRIVE_SCOPE, clientFor, disconnect, getConnectionInfo, saveConnection, type DriveSecrets } from '../lib/drive-connection.ts';
import { DRIVE_ERROR_MESSAGES, DriveError } from '../lib/drive.ts';
import {
  addSyncFolder, browseFolders, importDocuments, listAvailable, listImported, listSyncFolders, readDocument, reclassify,
  refreshAvailable, removeSyncFolder, syncAll, syncConnection, syncIfStale,
} from '../lib/drive-sync.ts';
import { can } from '../lib/permissions.ts';
import { addAppearance, addRelation, archiveCharacter, createCharacter, getCharacter, listCharacters, removeAppearance, removeCharacterPhoto, removeRelation, setCharacterPhoto, updateCharacter, updateRelation } from '../lib/characters.ts';
import { getImage, imageUsage, MAX_IMAGE_BYTES } from '../lib/images.ts';
import { archive, createEpisode, createSeason, getEpisode, linkDocument, listSeasons, reorderEpisodes, reorderSeasons, setMainDocument, unlinkDocument, updateEpisode, updateSeason } from '../lib/seasons.ts';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OWNER_EMAIL: string;
  GOOGLE_CLIENT_ID: string; // secret Cloudflare : « wrangler secret put GOOGLE_CLIENT_ID »
  GOOGLE_CLIENT_SECRET: string; // secret Cloudflare
  TOKEN_ENCRYPTION_KEY: string; // secret Cloudflare : 32 octets en base64url (voir docs/GOOGLE_INTEGRATION.md)
}
type Vars = { user: SessionUser };

const SESSION_COOKIE = '__Host-session';
const OAUTH_COOKIE = '__Host-oauth';
const db = (env: Env) => env.DB as unknown as DB;
const secretsOf = (env: Env): DriveSecrets => ({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, encryptionKey: env.TOKEN_ENCRYPTION_KEY });
const DRIVE_OAUTH_COOKIE = '__Host-drive-oauth';

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// En-têtes de sécurité sur toutes les réponses de l'API.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});

// Protection CSRF : toute requête qui modifie des données doit venir de notre propre origine.
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('Origin') !== new URL(c.req.url).origin) return c.json({ erreur: 'origine_refusee' }, 403);
  }
  await next();
});

// ---------- Authentification Google (OAuth 2.0, code d'autorisation + PKCE) ----------

app.get('/api/auth/login', async (c) => {
  const url = new URL(c.req.url);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const invite = url.searchParams.get('invite') ?? '';
  setCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, invite }), {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600,
  });
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile', // phase 2 : identité uniquement, aucun accès Drive
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return c.redirect(auth.toString());
});

const fail = (c: { redirect: (u: string) => Response }, code: string) => c.redirect(`/?erreur=${code}`);

app.get('/api/auth/callback', async (c) => {
  const url = new URL(c.req.url);
  const raw = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: '/', secure: true });
  if (!raw) return fail(c, 'session_expiree');
  let saved: { state: string; verifier: string; invite: string };
  try { saved = JSON.parse(raw); } catch { return fail(c, 'session_expiree'); }

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code || url.searchParams.get('state') !== saved.state) return fail(c, 'connexion_refusee');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: 'authorization_code',
      code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) return fail(c, 'echange_impossible');
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail(c, 'echange_impossible');

  // Le jeton d'identité vient directement de Google en HTTPS : on contrôle ses revendications.
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(new TextDecoder().decode(fromBase64Url(id_token.split('.')[1]))); } catch { return fail(c, 'echange_impossible'); }
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issuerOk || claims.aud !== c.env.GOOGLE_CLIENT_ID || Number(claims.exp) * 1000 < Date.now()) return fail(c, 'jeton_invalide');

  const profile: GoogleProfile = {
    sub: String(claims.sub),
    email: String(claims.email ?? ''),
    emailVerified: claims.email_verified === true,
    name: (claims.name as string) ?? null,
    picture: (claims.picture as string) ?? null,
  };
  const result = await authorizeLogin(db(c.env), { profile, inviteToken: saved.invite || null, ownerEmail: c.env.OWNER_EMAIL });
  if (!result.ok) return fail(c, result.reason);

  const session = await createSession(db(c.env), result.userId);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_DAYS * 86400,
  });
  return c.redirect('/');
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(db(c.env), token);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---------- Routes protégées ----------

app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  const user = await getSessionUser(db(c.env), getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ erreur: 'non_connecte' }, 401);
  c.set('user', user);
  await next();
});

app.get('/api/me', (c) => c.json(c.get('user')));

app.get('/api/series', async (c) => {
  const s = await getSeries(db(c.env), c.get('user').userId);
  return s ? c.json(s) : c.json({ erreur: 'forbidden' }, 403);
});

app.put('/api/series', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ erreur: 'invalid_body' }, 400);
  const r = await updateSeries(db(c.env), c.get('user').userId, body);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, r.reason === 'forbidden' ? 403 : 400);
});

app.get('/api/dashboard', async (c) => {
  const d = await getDashboard(db(c.env), c.get('user').userId);
  return d ? c.json(d) : c.json({ erreur: 'forbidden' }, 403);
});

const status = (reason: string) => (reason === 'forbidden' ? 403 : reason === 'not_found' ? 404 : reason === 'already_exists' || reason === 'storage_full' ? 409 : 400);

app.get('/api/admin/invitations', async (c) => {
  const list = await listPendingInvitations(db(c.env), c.get('user').userId);
  return list ? c.json(list) : c.json({ erreur: 'forbidden' }, 403);
});

app.post('/api/admin/invitations', async (c) => {
  const body = await c.req.json<{ email?: string; role?: string }>().catch(() => ({}) as { email?: string; role?: string });
  const r = await createInvitation(db(c.env), c.get('user').userId, { email: String(body.email ?? ''), role: body.role as never });
  if (!r.ok) return c.json({ erreur: r.reason }, status(r.reason));
  // Le lien n'est montré qu'une fois à l'administrateur ; seul son hachage est conservé.
  return c.json({ id: r.invitationId, expiresAt: r.expiresAt, lien: `${new URL(c.req.url).origin}/api/auth/login?invite=${r.token}` });
});

app.delete('/api/admin/invitations/:id', async (c) => {
  const r = await cancelInvitation(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

app.get('/api/admin/members', async (c) => {
  const me = c.get('user');
  if (me.role !== 'admin') return c.json({ erreur: 'forbidden' }, 403);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture_url AS picture, m.role, m.is_owner AS isOwner, m.description, m.joined_at AS joinedAt
     FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.removed_at IS NULL ORDER BY m.joined_at`,
  ).all();
  return c.json(results);
});

app.patch('/api/admin/members/:id', async (c) => {
  const body = await c.req.json<{ role?: string }>().catch(() => ({}) as { role?: string });
  const r = await setRole(db(c.env), c.get('user').userId, c.req.param('id'), body.role as never);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

app.delete('/api/admin/members/:id', async (c) => {
  const r = await removeMember(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

app.put('/api/admin/members/:id/grants/:resourceId', async (c) => {
  const body = await c.req.json<{ level?: string | null }>().catch(() => ({}) as { level?: string | null });
  const r = await setGrant(db(c.env), c.get('user').userId, c.req.param('id'), c.req.param('resourceId'), (body.level ?? null) as never);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

// ---------- Saisons et épisodes ----------
const body = <T,>(c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => ({})) as Promise<T>;

app.get('/api/seasons', async (c) => {
  const r = await listSeasons(db(c.env), c.get('user').userId);
  return r ? c.json(r) : c.json({ erreur: 'forbidden' }, 403);
});
app.post('/api/seasons', async (c) => {
  const r = await createSeason(db(c.env), c.get('user').userId, await body(c));
  return r.ok ? c.json(r, 201) : c.json({ erreur: r.reason }, status(r.reason));
});
app.post('/api/seasons/reorder', async (c) => {
  const b = await body<{ ids?: string[] }>(c);
  const r = await reorderSeasons(db(c.env), c.get('user').userId, b.ids as string[]);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.patch('/api/seasons/:id', async (c) => {
  const r = await updateSeason(db(c.env), c.get('user').userId, c.req.param('id'), await body(c));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/seasons/:id', async (c) => {
  const r = await archive(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

app.post('/api/episodes', async (c) => {
  const r = await createEpisode(db(c.env), c.get('user').userId, await body(c));
  return r.ok ? c.json(r, 201) : c.json({ erreur: r.reason }, status(r.reason));
});
app.post('/api/episodes/reorder', async (c) => {
  const b = await body<{ seasonId?: string | null; ids?: string[] }>(c);
  const r = await reorderEpisodes(db(c.env), c.get('user').userId, b.seasonId ?? null, b.ids as string[]);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.get('/api/episodes/:id', async (c) => {
  const e = await getEpisode(db(c.env), c.get('user').userId, c.req.param('id'));
  return e ? c.json(e) : c.json({ erreur: 'forbidden' }, 403);
});
app.patch('/api/episodes/:id', async (c) => {
  const r = await updateEpisode(db(c.env), c.get('user').userId, c.req.param('id'), await body(c));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/episodes/:id', async (c) => {
  const r = await archive(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.put('/api/episodes/:id/documents/:docId', async (c) => {
  const b = await body<{ main?: boolean }>(c);
  const me = c.get('user').userId;
  const r = await linkDocument(db(c.env), me, c.req.param('id'), c.req.param('docId'), b.main === true);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.put('/api/episodes/:id/main-document', async (c) => {
  const b = await body<{ documentId?: string | null }>(c);
  const r = await setMainDocument(db(c.env), c.get('user').userId, c.req.param('id'), b.documentId ?? null);
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/episodes/:id/documents/:docId', async (c) => {
  const r = await unlinkDocument(db(c.env), c.get('user').userId, c.req.param('id'), c.req.param('docId'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

// ---------- Personnages et images ----------
app.get('/api/characters', async (c) => {
  const r = await listCharacters(db(c.env), c.get('user').userId);
  return r ? c.json(r) : c.json({ erreur: 'forbidden' }, 403);
});
app.post('/api/characters', async (c) => {
  const r = await createCharacter(db(c.env), c.get('user').userId, await body(c));
  return r.ok ? c.json(r, 201) : c.json({ erreur: r.reason }, status(r.reason));
});
app.get('/api/characters/:id', async (c) => {
  const r = await getCharacter(db(c.env), c.get('user').userId, c.req.param('id'));
  return r ? c.json(r) : c.json({ erreur: 'forbidden' }, 403);
});
app.patch('/api/characters/:id', async (c) => {
  const r = await updateCharacter(db(c.env), c.get('user').userId, c.req.param('id'), await body(c));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/characters/:id', async (c) => {
  const r = await archiveCharacter(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
/** Envoi de la photo : corps binaire brut (déjà réduit par le navigateur). Format vérifié par signature côté serveur. */
app.put('/api/characters/:id/photo', async (c) => {
  const declared = Number(c.req.header('Content-Length') ?? 0);
  if (declared > MAX_IMAGE_BYTES + 1024) return c.json({ erreur: 'image_too_large' }, 413);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const r = await setCharacterPhoto(db(c.env), c.get('user').userId, c.req.param('id'), bytes);
  return r.ok ? c.json(r) : c.json({ erreur: r.reason }, r.reason === 'image_too_large' ? 413 : status(r.reason));
});
app.delete('/api/characters/:id/photo', async (c) => {
  const r = await removeCharacterPhoto(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.get('/api/images/:id', async (c) => {
  const img = await getImage(db(c.env), c.get('user').userId, c.req.param('id'));
  if (!img) return c.json({ erreur: 'introuvable' }, 404);
  return new Response(img.bytes, { headers: {
    'Content-Type': img.mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'", 'Content-Disposition': 'inline',
  } });
});
app.get('/api/storage', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ erreur: 'forbidden' }, 403);
  return c.json(await imageUsage(db(c.env)));
});
app.post('/api/characters/:id/relations', async (c) => {
  const b = await body<{ otherId?: string; kind?: string; description?: string }>(c);
  const r = await addRelation(db(c.env), c.get('user').userId, c.req.param('id'), String(b.otherId ?? ''), b.kind, b.description);
  return r.ok ? c.json(r, 201) : c.json({ erreur: r.reason }, status(r.reason));
});
app.patch('/api/relations/:id', async (c) => {
  const r = await updateRelation(db(c.env), c.get('user').userId, c.req.param('id'), await body(c));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/relations/:id', async (c) => {
  const r = await removeRelation(db(c.env), c.get('user').userId, c.req.param('id'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.put('/api/characters/:id/appearances/:episodeId', async (c) => {
  const r = await addAppearance(db(c.env), c.get('user').userId, c.req.param('id'), c.req.param('episodeId'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});
app.delete('/api/characters/:id/appearances/:episodeId', async (c) => {
  const r = await removeAppearance(db(c.env), c.get('user').userId, c.req.param('id'), c.req.param('episodeId'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

// ---------- Google Drive (lecture seule) ----------
// Le jeton Google n'est jamais envoyé au navigateur : tout passe par ces routes, qui contrôlent les droits.

/** Démarre la demande d'autorisation Drive (portée en lecture seule), séparée de la connexion. */
app.get('/api/drive/connect', async (c) => {
  const me = c.get('user');
  if (!(await can(db(c.env), me.userId, 'write', 'series'))) return c.redirect('/#/parametres?drive=refuse');
  const url = new URL(c.req.url);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  setCookie(c, DRIVE_OAUTH_COOKIE, JSON.stringify({ state, verifier, user: me.userId }), { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/drive/callback`,
    response_type: 'code',
    scope: `openid ${DRIVE_SCOPE}`,
    access_type: 'offline', // nécessaire pour la synchronisation automatique
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: me.email,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return c.redirect(auth.toString());
});

app.get('/api/drive/callback', async (c) => {
  const me = c.get('user');
  const url = new URL(c.req.url);
  const raw = getCookie(c, DRIVE_OAUTH_COOKIE);
  deleteCookie(c, DRIVE_OAUTH_COOKIE, { path: '/', secure: true });
  const back = (code: string) => c.redirect(`/#/parametres?drive=${code}`);
  let saved: { state: string; verifier: string; user: string };
  try { saved = JSON.parse(raw ?? ''); } catch { return back('expire'); }
  const code = url.searchParams.get('code');
  if (saved.user !== me.userId || url.searchParams.get('error') || !code || url.searchParams.get('state') !== saved.state) return back('refuse');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/drive/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier,
    }),
  });
  if (!tokenRes.ok) return back('echec');
  const tok = (await tokenRes.json()) as { refresh_token?: string; id_token?: string; scope?: string };
  if (!tok.refresh_token || !tok.id_token) return back('echec');
  // Le compte Google autorisé doit être celui de l'utilisateur connecté (même identifiant « sub »).
  let sub = '';
  try { sub = String(JSON.parse(new TextDecoder().decode(fromBase64Url(tok.id_token.split('.')[1]))).sub); } catch { return back('echec'); }
  const owner = await c.env.DB.prepare('SELECT google_sub AS sub FROM users WHERE id = ?').bind(me.userId).first<{ sub: string | null }>();
  if (!owner || owner.sub !== sub) return back('autre_compte');
  // La portée accordée doit être exactement la lecture seule demandée.
  if (!(tok.scope ?? '').split(' ').includes(DRIVE_SCOPE)) return back('portee');

  await saveConnection(db(c.env), me.userId, tok.refresh_token, DRIVE_SCOPE, c.env.TOKEN_ENCRYPTION_KEY);
  return back('ok');
});

const driveFail = (c: { json: (b: unknown, s?: never) => Response }, e: unknown) => {
  const kind = e instanceof DriveError ? e.kind : 'unknown';
  const code = kind === 'auth_revoked' ? 409 : kind === 'forbidden' ? 403 : kind === 'not_found' ? 404 : kind === 'rate_limited' || kind === 'temporary' ? 503 : 502;
  return c.json({ erreur: kind, message: DRIVE_ERROR_MESSAGES[kind] ?? DRIVE_ERROR_MESSAGES.unknown }, code as never);
};

app.get('/api/drive/status', async (c) => {
  const me = c.get('user');
  const connection = await getConnectionInfo(db(c.env), me.userId);
  const folders = connection ? await listSyncFolders(db(c.env), me.userId) : [];
  return c.json({ connection, folders, canConnect: await can(db(c.env), me.userId, 'write', 'series') });
});

app.delete('/api/drive/connection', async (c) => {
  const ok = await disconnect(db(c.env), c.get('user').userId, c.env.TOKEN_ENCRYPTION_KEY);
  return ok ? c.json({ ok: true }) : c.json({ erreur: 'not_found' }, 404);
});

app.get('/api/drive/folders', async (c) => {
  try {
    const parent = c.req.query('parent') ?? 'root';
    return c.json(await browseFolders(await clientFor(db(c.env), c.get('user').userId, secretsOf(c.env)), parent));
  } catch (e) { return driveFail(c, e); }
});

app.post('/api/drive/sync-folders', async (c) => {
  const body = await c.req.json<{ folderId?: string }>().catch(() => ({}) as { folderId?: string });
  try {
    const me = c.get('user');
    const drive = await clientFor(db(c.env), me.userId, secretsOf(c.env));
    const r = await addSyncFolder(db(c.env), me.userId, drive, String(body.folderId ?? ''));
    if (!r.ok) return c.json({ erreur: r.reason }, status(r.reason));
    c.executionCtx.waitUntil(refreshAvailable(db(c.env), me.userId, drive).catch(() => {}));
    return c.json(r);
  } catch (e) { return driveFail(c, e); }
});

app.delete('/api/drive/sync-folders/:folderId', async (c) => {
  const r = await removeSyncFolder(db(c.env), c.get('user').userId, c.req.param('folderId'));
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

/** Synchronisation à la demande (bouton « Synchroniser maintenant »). */
app.post('/api/drive/sync', async (c) => {
  const me = c.get('user');
  const result = await syncConnection(db(c.env), me.userId, secretsOf(c.env));
  return c.json(result, result.ok ? 200 : 502);
});

app.get('/api/drive/available', async (c) => {
  const me = c.get('user');
  if (!(await can(db(c.env), me.userId, 'write', 'series'))) return c.json({ erreur: 'forbidden' }, 403);
  if (c.req.query('refresh') === '1') {
    try { await refreshAvailable(db(c.env), me.userId, await clientFor(db(c.env), me.userId, secretsOf(c.env))); } catch (e) { return driveFail(c, e); }
  }
  return c.json(await listAvailable(db(c.env), me.userId));
});

app.post('/api/drive/import', async (c) => {
  const body = await c.req.json<{ items?: { id: string; category: string; sectionId: string }[] }>().catch(() => ({}) as { items?: never[] });
  const r = await importDocuments(db(c.env), c.get('user').userId, Array.isArray(body.items) ? body.items.slice(0, 200) : []);
  return r.ok ? c.json(r) : c.json({ erreur: r.reason }, status(r.reason));
});

app.get('/api/documents', async (c) => {
  const me = c.get('user');
  // Mise à jour automatique si la dernière synchronisation date de plus de 2 minutes (le Cron fait le reste).
  c.executionCtx.waitUntil(syncIfStale(db(c.env), me.userId, secretsOf(c.env), 120_000).catch(() => {}));
  return c.json(await listImported(db(c.env), me.userId));
});

app.patch('/api/documents/:id', async (c) => {
  const body = await c.req.json<{ category?: string; sectionId?: string }>().catch(() => ({}) as { category?: string; sectionId?: string });
  const r = await reclassify(db(c.env), c.get('user').userId, c.req.param('id'), { category: body.category, sectionId: body.sectionId });
  return r.ok ? c.json({ ok: true }) : c.json({ erreur: r.reason }, status(r.reason));
});

/** Contenu d'un document : lu à la volée avec le compte Google de la personne, jamais copié en base. */
app.get('/api/documents/:id/content', async (c) => {
  const r = await readDocument(db(c.env), c.get('user').userId, c.req.param('id'), secretsOf(c.env));
  if (r.ok) return c.json({ html: r.html, title: r.title, openUrl: r.openUrl });
  const http = r.reason === 'forbidden' ? 403 : r.reason === 'not_found' || r.reason === 'inaccessible' ? 404 : r.reason === 'reauth_required' || r.reason === 'not_connected' ? 409 : r.reason === 'temporary' || r.reason === 'rate_limited' ? 503 : 422;
  return c.json({ erreur: r.reason, message: DRIVE_ERROR_MESSAGES[r.reason] ?? DRIVE_ERROR_MESSAGES.unknown }, http);
});

app.notFound((c) => c.json({ erreur: 'introuvable' }, 404));
app.onError((err, c) => {
  console.error('Erreur serveur', err.message); // jamais de jeton ni de donnée personnelle dans les journaux
  return c.json({ erreur: 'erreur_interne' }, 500);
});

export default {
  fetch: app.fetch,
  // Tâche planifiée (Cron Trigger, gratuit) : synchronise les connexions Drive actives, par lots limités.
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(syncAll(db(env), secretsOf(env)).catch((e) => console.error('Synchronisation planifiée en échec', (e as Error).message)));
  },
};
