import { useEffect, useState } from 'react';
import { api, apiError, ROLE_LABEL, type Me, type Series } from '../api.ts';
import { applyTheme, getThemePref, type ThemePref } from '../theme.ts';
import { Invitations } from './Invitations.tsx';

const TABS = [
  { id: 'serie', label: 'Série' },
  { id: 'affichage', label: 'Affichage' },
  { id: 'collaborateurs', label: 'Collaborateurs' },
  { id: 'compte', label: 'Compte' },
];

interface Props { me: Me; series: Series; route: string; onSeriesSaved: () => void }

export function Settings({ me, series, route, onSeriesSaved }: Props) {
  const tab = TABS.find((t) => route === `parametres/${t.id}`)?.id ?? 'serie';
  return (
    <>
      <h1>Paramètres</h1>
      <nav className="tabs" aria-label="Sections des paramètres">
        {TABS.map((t) => <a key={t.id} href={`#/parametres/${t.id}`} aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a>)}
      </nav>
      {tab === 'serie' && <SeriesForm series={series} onSaved={onSeriesSaved} />}
      {tab === 'affichage' && <Display />}
      {tab === 'collaborateurs' && <Team me={me} />}
      {tab === 'compte' && <Account me={me} />}
    </>
  );
}

function SeriesForm({ series, onSaved }: { series: Series; onSaved: () => void }) {
  const [f, setF] = useState(() => ({ ...series, plannedSeasons: series.plannedSeasons?.toString() ?? '', avgDurationMin: series.avgDurationMin?.toString() ?? '' }));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setStatus(null);
    const body = {
      title: f.title, genre: f.genre ?? '', format: f.format ?? '', summary: f.summary ?? '', audience: f.audience ?? '',
      inspirations: f.inspirations ?? '', notes: f.notes ?? '', accentColor: f.accentColor,
      plannedSeasons: f.plannedSeasons === '' ? null : Number(f.plannedSeasons),
      avgDurationMin: f.avgDurationMin === '' ? null : Number(f.avgDurationMin),
    };
    const r = await api('/api/series', { method: 'PUT', body: JSON.stringify(body) });
    setBusy(false);
    if (r.ok) { setStatus({ ok: true, text: 'Modifications enregistrées.' }); onSaved(); } else setStatus({ ok: false, text: apiError(r.erreur) });
  };

  return (
    <form className="card form" onSubmit={save}>
      <label>Titre de la série<input value={f.title} onChange={set('title')} required maxLength={200} /></label>
      <div className="two">
        <label>Genre<input value={f.genre ?? ''} onChange={set('genre')} placeholder="Comédie, drame…" /></label>
        <label>Format<input value={f.format ?? ''} onChange={set('format')} placeholder="Sitcom, série dramatique…" /></label>
      </div>
      <label>Résumé<textarea rows={4} value={f.summary ?? ''} onChange={set('summary')} /></label>
      <div className="two">
        <label>Nombre de saisons prévues<input type="number" min={1} max={99} value={f.plannedSeasons} onChange={set('plannedSeasons')} /></label>
        <label>Durée moyenne d'un épisode (minutes)<input type="number" min={1} max={600} value={f.avgDurationMin} onChange={set('avgDurationMin')} /></label>
      </div>
      <label>Public cible<input value={f.audience ?? ''} onChange={set('audience')} /></label>
      <label>Inspirations et références<textarea rows={3} value={f.inspirations ?? ''} onChange={set('inspirations')} /></label>
      <label>Notes personnelles<textarea rows={3} value={f.notes ?? ''} onChange={set('notes')} /></label>
      <div className="color-row">
        <label>Couleur principale de la série
          <input type="color" value={f.accentColor ?? '#2563eb'} onChange={(e) => setF({ ...f, accentColor: e.target.value })} />
        </label>
        {f.accentColor && <button type="button" className="secondary" onClick={() => setF({ ...f, accentColor: null })}>Revenir au bleu par défaut</button>}
      </div>
      <p className="muted">Le logo, l'affiche et l'image de couverture seront ajoutés avec la gestion des images (phase 6).</p>
      {status && <div className={status.ok ? 'ok' : 'alert'} role={status.ok ? 'status' : 'alert'}>{status.text}</div>}
      <div><button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </form>
  );
}

function Display() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const choose = (p: ThemePref) => { setPref(p); applyTheme(p); };
  return (
    <section className="card">
      <h2>Thème</h2>
      <p className="muted">Ce choix est enregistré sur cet appareil.</p>
      <div className="seg" role="radiogroup" aria-label="Thème">
        {([['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']] as const).map(([v, l]) => (
          <button key={v} role="radio" aria-checked={pref === v} className={pref === v ? 'on' : ''} onClick={() => choose(v)}>{l}</button>
        ))}
      </div>
    </section>
  );
}

interface Member { id: string; email: string; name: string | null; role: string; isOwner: number; joinedAt: string }

function Team({ me }: { me: Me }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => {
    if (me.role === 'admin') api<Member[]>('/api/admin/members').then((r) => r.ok && setMembers(r.data));
  }, [me.role]);

  if (me.role !== 'admin') return <section className="card"><p>La gestion des collaborateurs est réservée aux administrateurs.</p></section>;
  return (
    <>
      <section className="card">
        <h2>Collaborateurs</h2>
        {!members ? <p className="muted">Chargement…</p> : members.map((m) => (
          <div className="row spread" key={m.id}>
            <span>{m.name ?? m.email} <small>· {m.email}</small></span>
            <span className="badge">{ROLE_LABEL[m.role]}{m.isOwner ? ' · propriétaire' : ''}</span>
          </div>
        ))}
        <p className="muted">La modification des rôles, des permissions et le retrait de collaborateurs arriveront en phase 13.</p>
      </section>
      <Invitations />
    </>
  );
}

function Account({ me }: { me: Me }) {
  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/'; };
  return (
    <section className="card">
      <h2>Mon compte</h2>
      <p>{me.name ?? me.email}<br /><small className="muted">{me.email} · {ROLE_LABEL[me.role]}{me.isOwner ? ' (propriétaire)' : ''}</small></p>
      <p className="muted">Connexion assurée par votre compte Google. L'application ne stocke aucun mot de passe.</p>
      <button className="secondary" onClick={logout}>Se déconnecter</button>
    </section>
  );
}
