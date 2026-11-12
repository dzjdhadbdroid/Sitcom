import { useCallback, useEffect, useState } from 'react';
import { api, apiError, CATEGORY_LABEL, episodeTitle, KIND_NAMES, STATUS_LABEL, STATUS_NAMES, type DocItem, type EpisodeDetail, type EpisodeKind, type EpisodeRow, type EpisodeStatus, type Me, type SeasonRow, type SeasonsData } from '../api.ts';

type View = 'list' | 'cards';
const readView = (): View => { try { return localStorage.getItem('seasons.view') === 'cards' ? 'cards' : 'list'; } catch { return 'list'; } };
const canEdit = (me: Me) => me.role !== 'reader'; // indicatif : le serveur reste seul juge (les exceptions par saison sont vérifiées là-bas)

function StatusBadge({ s }: { s: EpisodeStatus }) {
  return <span className={`badge st-${s}`}>{STATUS_NAMES[s]}</span>;
}

function EpisodeItem({ e, view }: { e: EpisodeRow; view: View }) {
  const body = (
    <>
      <span className="code">{e.code}</span> <strong>{episodeTitle(e)}</strong>
      {e.kind !== 'regular' && <small className="muted"> · {KIND_NAMES[e.kind]}</small>}
    </>
  );
  const meta = (
    <span className="ep-meta">
      <StatusBadge s={e.status} />
      {e.durationMin ? <small className="muted">{e.durationMin} min</small> : null}
      <small className="muted">{e.documentCount} doc.{e.hasMainScript ? ' · scénario principal ✓' : ''}</small>
    </span>
  );
  return view === 'cards' ? (
    <a className="ep-card card" href={`#/saisons/e/${e.id}`}>
      <div>{body}</div>
      {e.summary && <p className="muted clamp">{e.summary}</p>}
      {meta}
    </a>
  ) : (
    <a className="ep-row" href={`#/saisons/e/${e.id}`}>
      <span>{body}</span>
      {meta}
    </a>
  );
}

export function Seasons({ me }: { me: Me }) {
  const [data, setData] = useState<SeasonsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const r = await api<SeasonsData>('/api/seasons');
    if (r.ok) { setData(r.data); setError(null); } else setError(apiError(r.erreur));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const chooseView = (v: View) => { setView(v); try { localStorage.setItem('seasons.view', v); } catch { /* facultatif */ } };

  const move = async (list: { id: string }[], i: number, dir: -1 | 1, url: string, extra: object = {}) => {
    const ids = list.map((x) => x.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    const r = await api(url, { method: 'POST', body: JSON.stringify({ ...extra, ids }) });
    if (!r.ok) setError(apiError(r.erreur));
    void load();
  };

  return (
    <>
      <div className="row spread head">
        <h1>Saisons et épisodes</h1>
        <div className="row">
          <div className="seg" role="group" aria-label="Mode d'affichage">
            <button aria-pressed={view === 'list'} onClick={() => chooseView('list')}>Liste</button>
            <button aria-pressed={view === 'cards'} onClick={() => chooseView('cards')}>Cartes</button>
          </div>
          {canEdit(me) && <button className="btn" onClick={() => setCreating(true)}>Nouvelle saison</button>}
        </div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {creating && <NewSeason onDone={() => { setCreating(false); void load(); }} onCancel={() => setCreating(false)} />}
      {!data && !error && <p className="muted">Chargement…</p>}
      {data && data.seasons.length === 0 && data.loose.length === 0 && !creating && (
        <div className="card empty-state"><p>Aucune saison pour l'instant.</p>{canEdit(me) && <p className="muted">Créez une saison vide, ou avec un nombre d'épisodes pour générer les emplacements.</p>}</div>
      )}
      {data?.seasons.map((s, i) => (
        <SeasonBlock key={s.id} s={s} view={view} editable={canEdit(me)} reload={load} setError={setError}
          up={i > 0 ? () => move(data.seasons, i, -1, '/api/seasons/reorder') : undefined}
          down={i < data.seasons.length - 1 ? () => move(data.seasons, i, 1, '/api/seasons/reorder') : undefined}
          moveEp={(j, dir) => move(s.episodes, j, dir, '/api/episodes/reorder', { seasonId: s.id })} />
      ))}
      {data && data.loose.length > 0 && (
        <section className="card" aria-labelledby="hs">
          <h2 id="hs">Hors saison</h2>
          <div className={view === 'cards' ? 'ep-grid' : 'ep-list'}>{data.loose.map((e) => <EpisodeItem key={e.id} e={e} view={view} />)}</div>
        </section>
      )}
      {data && canEdit(me) && <AddLoose reload={load} />}
    </>
  );
}

function NewSeason({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ title: '', number: '', episodeCount: '' });
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/seasons', { method: 'POST', body: JSON.stringify({ title: f.title, number: f.number === '' ? null : Number(f.number), episodeCount: f.episodeCount === '' ? 0 : Number(f.episodeCount) }) });
    if (r.ok) onDone(); else setErr(apiError(r.erreur));
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Nouvelle saison</h2>
      {err && <div className="alert" role="alert">{err}</div>}
      <label>Titre (facultatif)<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></label>
      <div className="two">
        <label>Numéro (automatique si vide)<input type="number" min={0} max={99} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        <label>Nombre d'épisodes à créer (0 = saison vide)<input type="number" min={0} max={60} value={f.episodeCount} onChange={(e) => setF({ ...f, episodeCount: e.target.value })} /></label>
      </div>
      <div className="row"><button className="btn" type="submit">Créer la saison</button><button className="btn secondary" type="button" onClick={onCancel}>Annuler</button></div>
    </form>
  );
}

function SeasonBlock({ s, view, editable, reload, setError, up, down, moveEp }: {
  s: SeasonRow; view: View; editable: boolean; reload: () => void; setError: (m: string | null) => void;
  up?: () => void; down?: () => void; moveEp: (i: number, dir: -1 | 1) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: s.title, number: s.number?.toString() ?? '', summary: s.summary ?? '' });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const patch = async (b: object) => { const r = await api(`/api/seasons/${s.id}`, { method: 'PATCH', body: JSON.stringify(b) }); if (!r.ok) setError(apiError(r.erreur)); else { setError(null); reload(); } return r.ok; };
  const save = async (e: React.FormEvent) => { e.preventDefault(); if (await patch({ title: f.title, number: f.number === '' ? null : Number(f.number), summary: f.summary })) setEdit(false); };
  const addEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/episodes', { method: 'POST', body: JSON.stringify({ seasonId: s.id, title })});
    if (!r.ok) setError(apiError(r.erreur)); else { setTitle(''); setAdding(false); reload(); }
  };
  const archive = async () => {
    if (!confirm('Archiver cette saison et ses épisodes ? Ils ne seront pas supprimés : ils seront consultables et restaurables depuis les archives.')) return;
    const r = await api(`/api/seasons/${s.id}`, { method: 'DELETE' });
    if (!r.ok) setError(apiError(r.erreur)); else reload();
  };
  const label = `${s.number != null ? `Saison ${s.number}` : 'Saison'}${s.title ? ` — ${s.title}` : ''}`;
  const done = s.episodes.filter((e) => e.status === 'done' || e.status === 'validated').length;

  return (
    <section className="card" aria-labelledby={`s-${s.id}`}>
      <div className="row spread">
        <h2 id={`s-${s.id}`}>{label}{s.finishedAt && <span className="badge st-validated">Terminée</span>}</h2>
        {editable && (
          <div className="row">
            <button className="btn secondary" onClick={up} disabled={!up} aria-label="Monter la saison">↑</button>
            <button className="btn secondary" onClick={down} disabled={!down} aria-label="Descendre la saison">↓</button>
            <button className="btn secondary" onClick={() => setEdit(!edit)}>Modifier</button>
          </div>
        )}
      </div>
      {s.episodes.length > 0 && <p className="muted">{done} / {s.episodes.length} épisode{s.episodes.length > 1 ? 's' : ''} terminé{done > 1 ? 's' : ''} ou validé{done > 1 ? 's' : ''}</p>}
      {s.summary && !edit && <p>{s.summary}</p>}
      {edit && (
        <form className="form" onSubmit={save}>
          <div className="two">
            <label>Titre<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></label>
            <label>Numéro<input type="number" min={0} max={99} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
          </div>
          <label>Résumé<textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
          <div className="row">
            <button className="btn" type="submit">Enregistrer</button>
            <button className="btn secondary" type="button" onClick={() => patch({ finished: !s.finishedAt })}>{s.finishedAt ? 'Marquer comme non terminée' : 'Marquer comme terminée'}</button>
            <button className="btn secondary" type="button" onClick={archive}>Archiver</button>
          </div>
        </form>
      )}
      {s.episodes.length === 0 ? <p className="empty">Aucun épisode dans cette saison.</p> : (
        <div className={view === 'cards' ? 'ep-grid' : 'ep-list'}>
          {s.episodes.map((e, i) => (
            <div className="ep-wrap" key={e.id}>
              <EpisodeItem e={e} view={view} />
              {editable && view === 'list' && (
                <span className="ep-move">
                  <button className="btn secondary" onClick={() => moveEp(i, -1)} disabled={i === 0} aria-label={`Monter ${e.code}`}>↑</button>
                  <button className="btn secondary" onClick={() => moveEp(i, 1)} disabled={i === s.episodes.length - 1} aria-label={`Descendre ${e.code}`}>↓</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {editable && (adding ? (
        <form className="row" onSubmit={addEpisode}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre du nouvel épisode (facultatif)" aria-label="Titre du nouvel épisode" maxLength={200} />
          <button className="btn" type="submit">Ajouter</button><button className="btn secondary" type="button" onClick={() => setAdding(false)}>Annuler</button>
        </form>
      ) : <button className="btn secondary" onClick={() => setAdding(true)}>Ajouter un épisode</button>)}
    </section>
  );
}

function AddLoose({ reload }: { reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', kind: 'bonus' as EpisodeKind });
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button className="btn secondary" onClick={() => setOpen(true)}>Ajouter un contenu hors saison</button>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/episodes', { method: 'POST', body: JSON.stringify({ seasonId: null, ...f }) });
    if (r.ok) { setOpen(false); setF({ title: '', kind: 'bonus' }); reload(); } else setErr(apiError(r.erreur));
  };
  return (
    <form className="card form" onSubmit={submit}>
      <h2>Contenu hors saison</h2>
      {err && <div className="alert" role="alert">{err}</div>}
      <div className="two">
        <label>Titre<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></label>
        <label>Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as EpisodeKind })}>{Object.entries(KIND_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <div className="row"><button className="btn" type="submit">Créer</button><button className="btn secondary" type="button" onClick={() => setOpen(false)}>Annuler</button></div>
    </form>
  );
}

// ---------- Fiche épisode ----------

export function EpisodePage({ id }: { id: string }) {
  const [ep, setEp] = useState<EpisodeDetail | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [f, setF] = useState<{ title: string; summary: string; number: string; durationMin: string; kind: EpisodeKind; status: EpisodeStatus; seasonId: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api<EpisodeDetail>(`/api/episodes/${encodeURIComponent(id)}`);
    if (!r.ok) { setError(apiError(r.erreur)); return; }
    const e = r.data;
    setEp(e);
    setF({ title: e.title, summary: e.summary ?? '', number: e.number?.toString() ?? '', durationMin: e.durationMin?.toString() ?? '', kind: e.kind, status: e.status, seasonId: e.seasonId ?? '' });
    const s = await api<SeasonsData>('/api/seasons');
    if (s.ok) setSeasons(s.data.seasons);
  }, [id]);
  useEffect(() => { setEp(null); setError(null); void load(); }, [load]);

  if (error) return <><p><a href="#/saisons">← Saisons</a></p><div className="alert" role="alert">{error}</div></>;
  if (!ep || !f) return <p className="muted">Chargement…</p>;
  const w = ep.canWrite;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => { setOk(false); setF({ ...f, [k]: e.target.value }); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api(`/api/episodes/${id}`, { method: 'PATCH', body: JSON.stringify({
      title: f.title, summary: f.summary, kind: f.kind, status: f.status, seasonId: f.seasonId || null,
      number: f.number === '' ? null : Number(f.number), durationMin: f.durationMin === '' ? null : Number(f.durationMin) }) });
    if (r.ok) { setError(null); setOk(true); void load(); } else setError(apiError(r.erreur));
  };
  const archive = async () => {
    if (!confirm('Archiver cet épisode ? Il ne sera pas supprimé : il restera consultable et restaurable depuis les archives. Les documents Google Docs ne sont pas touchés.')) return;
    const r = await api(`/api/episodes/${id}`, { method: 'DELETE' });
    if (r.ok) location.hash = '#/saisons'; else setError(apiError(r.erreur));
  };
  const act = async (url: string, method: string, b?: object) => { const r = await api(url, { method, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) setError(apiError(r.erreur)); else { setError(null); void load(); } };

  return (
    <>
      <p><a href="#/saisons">← Saisons</a></p>
      <h1><span className="code">{ep.code}</span> {episodeTitle(ep)}</h1>
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="notice" role="status">Modifications enregistrées.</div>}
      <form className="card form" onSubmit={save}>
        <fieldset disabled={!w}>
          <label>Titre<input value={f.title} onChange={set('title')} maxLength={200} /></label>
          <div className="two">
            <label>Type<select value={f.kind} onChange={set('kind')}>{Object.entries(KIND_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Numéro<input type="number" min={0} max={999} value={f.number} onChange={set('number')} /></label>
          </div>
          <div className="two">
            <label>Statut<select value={f.status} onChange={set('status')}>{Object.entries(STATUS_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Durée estimée (minutes)<input type="number" min={1} max={600} value={f.durationMin} onChange={set('durationMin')} /></label>
          </div>
          <label>Saison<select value={f.seasonId} onChange={set('seasonId')}>
            <option value="">Hors saison</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.number != null ? `Saison ${s.number}` : 'Saison'}{s.title ? ` — ${s.title}` : ''}</option>)}
          </select></label>
          <label>Résumé<textarea rows={4} value={f.summary} onChange={set('summary')} /></label>
        </fieldset>
        {w && <div className="row"><button className="btn" type="submit">Enregistrer</button><button className="btn secondary" type="button" onClick={archive}>Archiver</button></div>}
        {!w && <p className="muted">Vous avez un accès en lecture seule à cet épisode.</p>}
      </form>

      <section className="card" aria-labelledby="docs">
        <h2 id="docs">Documents associés</h2>
        {ep.documents.length === 0 ? <p className="empty">Aucun document associé.</p> : (
          <ul className="doclist">
            {ep.documents.map((d) => (
              <li key={d.id} className="row spread">
                <span>
                  {d.viewable ? <a href={`#/documents/${d.id}`}>{d.title}</a> : d.title}
                  {d.isMain && <span className="badge st-validated">Scénario principal</span>}
                  {d.category && <span className="badge">{CATEGORY_LABEL[d.category] ?? d.category}</span>}
                  {d.status !== 'ok' && <span className="warn" role="note">⚠ {STATUS_LABEL[d.status] ?? d.status}</span>}
                </span>
                {w && (
                  <span className="row">
                    <button className="btn secondary" onClick={() => act(`/api/episodes/${id}/main-document`, 'PUT', { documentId: d.isMain ? null : d.id })}>{d.isMain ? 'Retirer « principal »' : 'Scénario principal'}</button>
                    <button className="btn secondary" onClick={() => act(`/api/episodes/${id}/documents/${d.id}`, 'DELETE')}>Détacher</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {w && <LinkDocument episodeId={id} linked={new Set(ep.documents.map((d) => d.id))} onLinked={load} setError={setError} />}
      </section>
    </>
  );
}

function LinkDocument({ episodeId, linked, onLinked, setError }: { episodeId: string; linked: Set<string>; onLinked: () => void; setError: (m: string | null) => void }) {
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [pick, setPick] = useState('');
  const [main, setMain] = useState(false);
  useEffect(() => { api<DocItem[]>('/api/documents').then((r) => setDocs(r.ok ? r.data : [])); }, []);
  const options = (docs ?? []).filter((d) => !linked.has(d.id));
  if (docs && options.length === 0) return <p className="muted">Aucun autre document importé à associer. Les documents s'importent depuis <a href="#/parametres/drive">Paramètres → Google Drive</a>.</p>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    const r = await api(`/api/episodes/${episodeId}/documents/${pick}`, { method: 'PUT', body: JSON.stringify({ main }) });
    if (!r.ok) setError(apiError(r.erreur)); else { setPick(''); setMain(false); setError(null); onLinked(); }
  };
  return (
    <form className="row" onSubmit={submit}>
      <select aria-label="Document à associer" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Associer un document importé…</option>
        {options.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
      </select>
      <label className="check"><input type="checkbox" checked={main} onChange={(e) => setMain(e.target.checked)} /> Scénario principal</label>
      <button className="btn" type="submit" disabled={!pick}>Associer</button>
    </form>
  );
}
