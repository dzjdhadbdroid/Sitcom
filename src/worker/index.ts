import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { authorizeLogin, type GoogleProfile } from '../lib/auth.ts';
import { fromBase64Url, randomToken, toBase64Url } from '../lib/crypto.ts';
import { cancelInvitation, createInvitation, listPendingInvitations } from '../lib/invitations.ts';
import { removeMember, setGrant, setRole } from '../lib/members.ts';
import { createSession, getSessionUser, revokeSession, SESSION_TTL_DAYS, type SessionUser } from '../lib/sessions.ts';
import type { DB } from '../lib/db.ts';

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OWNER_EMAIL: string;
  GOOGLE_CLIENT_ID: string; // secret Cloudflare : « wrangler secret put GOOGLE_CLIENT_ID »
  GOOGLE_CLIENT_SECRET: string; // secret Cloudflare
}
type Vars = { user: SessionUser };

const SESSION_COOKIE = '__Host-session';
const OAUTH_COOKIE = '__Host-oauth';
const db = (env: Env) => env.DB as unknown as DB;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// En-têtes de sécurité sur toutes les réponses de l'API.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cache-Control', 'no-store');
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

const status = (reason: string) => (reason === 'forbidden' ? 403 : reason === 'not_found' ? 404 : 400);

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

app.notFound((c) => c.json({ erreur: 'introuvable' }, 404));
app.onError((err, c) => {
  console.error('Erreur serveur', err.message); // jamais de jeton ni de donnée personnelle dans les journaux
  return c.json({ erreur: 'erreur_interne' }, 500);
});

export default app;
