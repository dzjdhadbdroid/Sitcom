import { useEffect, useState } from 'react';
import { actionLabel, api, apiError, STATUS_NAMES, type Dashboard as DashboardData, type Me, type Series } from '../api.ts';

function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}

/** Tableau de bord : structure fixe, identique pour tous. Seules les données réellement disponibles sont affichées. */
export function Dashboard({ me, series }: { me: Me; series: Series }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardData>('/api/dashboard').then((r) => (r.ok ? setData(r.data) : setError(apiError(r.erreur))));
  }, []);

  const meta = [series.format, series.genre, series.plannedSeasons ? `${series.plannedSeasons} saison${series.plannedSeasons > 1 ? 's' : ''} prévue${series.plannedSeasons > 1 ? 's' : ''}` : null, series.avgDurationMin ? `${series.avgDurationMin} min / épisode` : null].filter(Boolean);

  return (
    <>
      <section className="hero card">
        <h1>{series.title}</h1>
        {meta.length > 0 && <p className="meta">{meta.join(' · ')}</p>}
        {series.summary ? <p className="summary">{series.summary}</p> : <p className="muted">Aucun résumé pour l'instant. Ajoutez-le dans <a href="#/parametres/serie">Paramètres → Série</a>.</p>}
      </section>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="grid">
        <section className="card" aria-labelledby="d-prog">
          <h2 id="d-prog">Progression globale</h2>
          {!data ? <p className="muted">Chargement…</p> : data.episodes.total === 0 ? <Empty>Aucun épisode pour l'instant. La progression s'affichera dès que des épisodes auront été créés.</Empty> : (() => {
            const done = data.episodes.byStatus.done + data.episodes.byStatus.validated;
            const pct = Math.round((done / data.episodes.total) * 100);
            return (<><p className="big">{pct} %<small> terminés ou validés</small></p><progress value={done} max={data.episodes.total} aria-label="Progression globale" /><p className="muted">{done} épisode{done > 1 ? 's' : ''} sur {data.episodes.total}</p></>);
          })()}
        </section>
        <section className="card" aria-labelledby="d-seasons">
          <h2 id="d-seasons">Avancement par saison</h2>
          {!data ? <p className="muted">Chargement…</p> : data.seasons.length === 0 ? <Empty>Aucune saison pour l'instant.</Empty> : (
            <ul className="activity">
              {data.seasons.map((x) => (
                <li key={x.id}>
                  <span>{x.number != null ? `Saison ${x.number}` : 'Saison'}{x.title ? ` — ${x.title}` : ''}{x.finished ? ' ✓' : ''}</span>
                  <span className="muted">{x.completed} / {x.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="d-status">
          <h2 id="d-status">Épisodes par statut</h2>
          {!data ? <p className="muted">Chargement…</p> : data.episodes.total === 0 ? <Empty>Aucun épisode pour l'instant.</Empty> : (
            <ul className="activity">
              {(Object.keys(STATUS_NAMES) as (keyof typeof STATUS_NAMES)[]).map((k) => <li key={k}><span>{STATUS_NAMES[k]}</span><strong>{data.episodes.byStatus[k]}</strong></li>)}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="d-chars">
          <h2 id="d-chars">Personnages</h2>
          <Empty>Aucun personnage pour l'instant.</Empty>
        </section>
        <section className="card" aria-labelledby="d-ideas">
          <h2 id="d-ideas">Idées en attente</h2>
          <Empty>Aucune idée pour l'instant.</Empty>
        </section>
        <section className="card" aria-labelledby="d-docs">
          <h2 id="d-docs">Derniers documents modifiés</h2>
          {!data ? <p className="muted">Chargement…</p> : data.recentDocuments.length === 0 ? <Empty>Aucun document importé pour l'instant.</Empty> : (
            <ul className="activity">
              {data.recentDocuments.map((d) => (
                <li key={d.id}>
                  <a href={`#/documents/${d.id}`}>{d.title}</a>
                  <time dateTime={d.modifiedTime ?? ''}>{d.modifiedTime ? new Date(d.modifiedTime).toLocaleDateString('fr-FR') : ''}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="d-team">
          <h2 id="d-team">Équipe</h2>
          {data ? (
            <>
              <p className="big">{data.members.total}<small> membre{data.members.total > 1 ? 's' : ''}</small></p>
              <p className="muted">{data.members.admins} administrateur{data.members.admins > 1 ? 's' : ''} · {data.members.editors} éditeur{data.members.editors > 1 ? 's' : ''} · {data.members.readers} lecteur{data.members.readers > 1 ? 's' : ''}</p>
            </>
          ) : <p className="muted">Chargement…</p>}
        </section>
        {me.role === 'admin' && (
          <section className="card wide" aria-labelledby="d-activity">
            <h2 id="d-activity">Activité récente</h2>
            {!data ? <p className="muted">Chargement…</p> : data.recentActivity && data.recentActivity.length > 0 ? (
              <ul className="activity">
                {data.recentActivity.map((a) => (
                  <li key={a.id}>
                    <span>{actionLabel(a.action)}{a.actorName ? <small> · {a.actorName}</small> : null}</span>
                    <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                  </li>
                ))}
              </ul>
            ) : <Empty>Aucune activité enregistrée.</Empty>}
          </section>
        )}
      </div>
    </>
  );
}
