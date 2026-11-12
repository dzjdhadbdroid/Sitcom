import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type Series } from './api.ts';
import { Shell } from './Shell.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { NotFound, Placeholder } from './pages/Placeholder.tsx';
import { Settings } from './pages/Settings.tsx';
import { CharacterPage, Characters } from './pages/Characters.tsx';
import { EpisodePage, Seasons } from './pages/Seasons.tsx';
import { DocumentList, DocumentReader } from './pages/Documents.tsx';
import { useRoute } from './router.ts';
import { SECTION_INFO } from './nav.ts';
import { applyAccent } from './theme.ts';

const LOGIN_ERRORS: Record<string, string> = {
  not_invited: "Cette adresse Google n'a pas été invitée. Demandez une invitation à l'administrateur.",
  invitation_unusable: 'Cette invitation est expirée, annulée ou déjà utilisée. Demandez-en une nouvelle.',
  google_account_mismatch: 'Cette adresse est déjà liée à un autre compte Google.',
  email_not_verified: "L'adresse e-mail de ce compte Google n'est pas vérifiée.",
  session_expiree: 'La tentative de connexion a expiré. Réessayez.',
  connexion_refusee: 'La connexion Google a été refusée ou interrompue.',
  echange_impossible: 'La connexion avec Google a échoué. Réessayez dans un instant.',
  jeton_invalide: 'La réponse de Google est invalide. Réessayez.',
  internal_error: 'Une erreur interne est survenue. Réessayez.',
};

function Login() {
  const params = new URLSearchParams(location.search);
  const erreur = params.get('erreur');
  const invite = params.get('invite');
  return (
    <main className="login">
      <div className="card">
        <h1>Ma série</h1>
        <p className="muted">Espace privé de gestion. L'accès se fait uniquement sur invitation, avec votre compte Google.</p>
        {erreur && <div className="alert" role="alert">{LOGIN_ERRORS[erreur] ?? 'Connexion impossible.'}</div>}
        <a className="btn" href={`/api/auth/login${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`}>Se connecter avec Google</a>
      </div>
    </main>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [series, setSeries] = useState<Series | null>(null);
  const route = useRoute();

  useEffect(() => {
    api<Me>('/api/me').then((r) => setMe(r.ok ? r.data : null));
  }, []);

  const loadSeries = useCallback(async () => {
    const r = await api<Series>('/api/series');
    if (r.ok) setSeries(r.data);
  }, []);
  useEffect(() => { if (me) void loadSeries(); }, [me, loadSeries]);

  useEffect(() => {
    applyAccent(series?.accentColor ?? null);
    document.title = series?.title ?? 'Ma série';
  }, [series]);

  if (me === undefined) return <main className="login"><p className="muted">Chargement…</p></main>;
  if (!me) return <Login />;
  if (!series) return <main className="login"><p className="muted">Chargement…</p></main>;

  const section = route.split('/')[0];
  let page;
  if (route === '') page = <Dashboard me={me} series={series} />;
  else if (section === 'parametres') page = <Settings me={me} series={series} route={route} onSeriesSaved={loadSeries} />;
  else if (route === 'saisons') page = <Seasons me={me} />;
  else if (route.startsWith('saisons/e/') && route.split('/').length === 3) page = <EpisodePage id={route.split('/')[2]} />;
  else if (route === 'personnages') page = <Characters me={me} />;
  else if (section === 'personnages' && route.split('/').length === 2) page = <CharacterPage id={route.split('/')[1]} />;
  else if (route === 'documents') page = <DocumentList />;
  else if (section === 'documents' && route.split('/').length === 2) page = <DocumentReader id={route.split('/')[1]} />;
  else if (SECTION_INFO[section] && route === section) page = <Placeholder section={section} />;
  else page = <NotFound />;

  return <Shell me={me} title={series.title} route={route}>{page}</Shell>;
}
