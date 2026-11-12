import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiError, episodeTitle, imageUrl, RELATION_NAMES, type CharacterCard, type CharacterDetail, type Me, type RelationKind, type SeasonsData } from '../api.ts';

type View = 'list' | 'gallery';
const readView = (): View => { try { return localStorage.getItem('characters.view') === 'gallery' ? 'gallery' : 'list'; } catch { return 'list'; } };

function Avatar({ id, name, size = 48 }: { id: string | null; name: string; size?: number }) {
  return id
    ? <img className="avatar" src={imageUrl(id)} alt={`Portrait de ${name}`} width={size} height={size} loading="lazy" />
    : <span className="avatar ph" style={{ width: size, height: size }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}

export function Characters({ me }: { me: Me }) {
  const [list, setList] = useState<CharacterCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(readView);
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '' });

  const load = useCallback(async () => {
    const r = await api<CharacterCard[]>('/api/characters');
    if (r.ok) { setList(r.data); setError(null); } else setError(apiError(r.erreur));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const choose = (v: View) => { setView(v); try { localStorage.setItem('characters.view', v); } catch { /* facultatif */ } };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api<{ id: string }>('/api/characters', { method: 'POST', body: JSON.stringify(f) });
    if (r.ok) location.hash = `#/personnages/${r.data.id}`; else setError(apiError(r.erreur));
  };

  return (
    <>
      <div className="row spread head">
        <h1>Personnages</h1>
        <div className="row">
          <div className="seg" role="group" aria-label="Mode d'affichage">
            <button aria-pressed={view === 'list'} onClick={() => choose('list')}>Liste</button>
            <button aria-pressed={view === 'gallery'} onClick={() => choose('gallery')}>Galerie</button>
          </div>
          {me.role !== 'reader' && <button className="btn" onClick={() => setCreating(true)}>Nouveau personnage</button>}
        </div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {creating && (
        <form className="card form" onSubmit={create}>
          <h2>Nouveau personnage</h2>
          <div className="two">
            <label>Prénom<input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} maxLength={100} /></label>
            <label>Nom<input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} maxLength={100} /></label>
          </div>
          <div className="row"><button className="btn" type="submit">Créer la fiche</button><button className="btn secondary" type="button" onClick={() => setCreating(false)}>Annuler</button></div>
        </form>
      )}
      {!list && !error && <p className="muted">Chargement…</p>}
      {list && list.length === 0 && !creating && <div className="card empty-state"><p>Aucun personnage pour l'instant.</p>{me.role !== 'reader' && <p className="muted">Créez une première fiche avec « Nouveau personnage ».</p>}</div>}
      {list && list.length > 0 && (view === 'gallery' ? (
        <div className="char-grid">
          {list.map((c) => (
            <a key={c.id} className="char-card card" href={`#/personnages/${c.id}`}>
              <Avatar id={c.photoImageId} name={c.name} size={160} />
              <strong>{c.name}</strong>
              {c.age && <small className="muted">{c.age}</small>}
              {c.excerpt && <p className="muted clamp">{c.excerpt}</p>}
              <small className="muted">{c.appearances} apparition{c.appearances > 1 ? 's' : ''}</small>
            </a>
          ))}
        </div>
      ) : (
        <ul className="card char-list">
          {list.map((c) => (
            <li key={c.id}>
              <a href={`#/personnages/${c.id}`} className="row"><Avatar id={c.photoImageId} name={c.name} /><span><strong>{c.name}</strong>{c.age && <small className="muted"> · {c.age}</small>}</span></a>
              <small className="muted">{c.appearances} apparition{c.appearances > 1 ? 's' : ''}</small>
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

/** Réduit la photo dans le navigateur (800 px max, JPEG) pour rester sous la limite de 1 Mo et économiser le stockage gratuit. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 900_000) return blob;
  }
  throw new Error('trop_lourde');
}

export function CharacterPage({ id }: { id: string }) {
  const [c, setC] = useState<CharacterDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await api<CharacterDetail>(`/api/characters/${encodeURIComponent(id)}`);
    if (!r.ok) { setError(apiError(r.erreur)); return; }
    const d = r.data;
    setC(d);
    setF({ firstName: d.firstName, lastName: d.lastName, age: d.age ?? '', physical: d.physical ?? '', personality: d.personality ?? '', history: d.history ?? '', qualities: d.qualities ?? '', flaws: d.flaws ?? '', particularities: d.particularities ?? '' });
  }, [id]);
  useEffect(() => { setC(null); setError(null); void load(); }, [load]);

  if (error && !c) return <><p><a href="#/personnages">← Personnages</a></p><div className="alert" role="alert">{error}</div></>;
  if (!c || !f) return <p className="muted">Chargement…</p>;
  const w = c.canWrite;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setOk(false); setF({ ...f, [k]: e.target.value }); };
  const act = async (url: string, method: string, b?: object) => { const r = await api(url, { method, body: b ? JSON.stringify(b) : undefined }); if (!r.ok) setError(apiError(r.erreur)); else { setError(null); void load(); } return r.ok; };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api(`/api/characters/${id}`, { method: 'PATCH', body: JSON.stringify(f) });
    if (r.ok) { setError(null); setOk(true); void load(); } else setError(apiError(r.erreur));
  };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setBusy(true);
    try {
      const blob = await shrink(picked);
      const r = await fetch(`/api/characters/${id}/photo`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' }, credentials: 'same-origin' });
      if (r.ok) { setError(null); void load(); } else setError(apiError(((await r.json().catch(() => ({}))) as { erreur?: string }).erreur ?? 'erreur'));
    } catch { setError('Cette image ne peut pas être lue. Utilisez un fichier JPEG, PNG ou WebP.'); }
    setBusy(false);
  };
  const archive = async () => {
    if (!confirm('Archiver ce personnage ? Il ne sera pas supprimé : sa fiche, ses relations et ses apparitions seront conservées et restaurables depuis les archives.')) return;
    if (await act(`/api/characters/${id}`, 'DELETE')) location.hash = '#/personnages';
  };

  const field = (k: string, label: string, rows = 3) => <label>{label}<textarea rows={rows} value={f[k]} onChange={set(k)} /></label>;

  return (
    <>
      <p><a href="#/personnages">← Personnages</a></p>
      <div className="row head-char"><Avatar id={c.photoImageId} name={c.name} size={96} /><h1>{c.name}</h1></div>
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="notice" role="status">Modifications enregistrées.</div>}

      {w && (
        <div className="row">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={upload} aria-label="Choisir une photo" />
          <button className="btn secondary" onClick={() => file.current?.click()} disabled={busy}>{busy ? 'Envoi…' : c.photoImageId ? 'Changer la photo' : 'Ajouter une photo'}</button>
          {c.photoImageId && <button className="btn secondary" onClick={() => act(`/api/characters/${id}/photo`, 'DELETE')}>Retirer la photo</button>}
          <small className="muted">La photo est réduite automatiquement (800 px, 1 Mo maximum).</small>
        </div>
      )}

      <form className="card form" onSubmit={save}>
        <fieldset disabled={!w}>
          <div className="two">
            <label>Prénom<input value={f.firstName} onChange={set('firstName')} maxLength={100} /></label>
            <label>Nom<input value={f.lastName} onChange={set('lastName')} maxLength={100} /></label>
          </div>
          <label>Âge<input value={f.age} onChange={set('age')} maxLength={40} placeholder="34 ans, environ 50 ans, adolescent…" /></label>
          {field('physical', 'Description physique')}
          {field('personality', 'Personnalité')}
          {field('history', 'Histoire et passé', 5)}
          <div className="two">{field('qualities', 'Qualités')}{field('flaws', 'Défauts')}</div>
          {field('particularities', 'Particularités')}
        </fieldset>
        {w ? <div className="row"><button className="btn" type="submit">Enregistrer</button><button className="btn secondary" type="button" onClick={archive}>Archiver</button></div> : <p className="muted">Vous avez un accès en lecture seule à cette fiche.</p>}
      </form>

      <Relations c={c} reload={load} setError={setError} />
      <Appearances c={c} reload={load} setError={setError} />
    </>
  );
}

function Relations({ c, reload, setError }: { c: CharacterDetail; reload: () => void; setError: (m: string | null) => void }) {
  const [others, setOthers] = useState<CharacterCard[]>([]);
  const [f, setF] = useState({ otherId: '', kind: 'friendship' as RelationKind, description: '' });
  useEffect(() => { if (c.canWrite) api<CharacterCard[]>('/api/characters').then((r) => r.ok && setOthers(r.data.filter((o) => o.id !== c.id))); }, [c.id, c.canWrite]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api(`/api/characters/${c.id}/relations`, { method: 'POST', body: JSON.stringify(f) });
    if (r.ok) { setF({ otherId: '', kind: 'friendship', description: '' }); setError(null); reload(); } else setError(apiError(r.erreur));
  };
  const remove = async (id: string) => {
    if (!confirm('Retirer cette relation ? Les deux personnages sont conservés.')) return;
    const r = await api(`/api/relations/${id}`, { method: 'DELETE' });
    if (r.ok) reload(); else setError(apiError(r.erreur));
  };
  return (
    <section className="card" aria-labelledby="rel">
      <h2 id="rel">Relations</h2>
      {c.relations.length === 0 ? <p className="empty">Aucune relation renseignée.</p> : (
        <ul className="doclist">
          {c.relations.map((r) => (
            <li key={r.id} className="row spread">
              <span><a href={`#/personnages/${r.otherId}`}>{r.otherName}</a> <span className="badge">{RELATION_NAMES[r.kind]}</span>{r.description && <small className="muted"> — {r.description}</small>}</span>
              {c.canWrite && <button className="btn secondary" onClick={() => remove(r.id)}>Retirer</button>}
            </li>
          ))}
        </ul>
      )}
      {c.canWrite && (
        <form className="row" onSubmit={add}>
          <select aria-label="Personnage à relier" value={f.otherId} onChange={(e) => setF({ ...f, otherId: e.target.value })}>
            <option value="">Relier à…</option>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select aria-label="Type de relation" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as RelationKind })}>
            {Object.entries(RELATION_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input aria-label="Description de la relation" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} />
          <button className="btn" type="submit" disabled={!f.otherId}>Ajouter</button>
        </form>
      )}
    </section>
  );
}

function Appearances({ c, reload, setError }: { c: CharacterDetail; reload: () => void; setError: (m: string | null) => void }) {
  const [data, setData] = useState<SeasonsData | null>(null);
  const [pick, setPick] = useState('');
  useEffect(() => { if (c.canWrite) api<SeasonsData>('/api/seasons').then((r) => r.ok && setData(r.data)); }, [c.canWrite]);
  const present = new Set(c.appearances.map((a) => a.episodeId));
  const all = data ? [...data.seasons.flatMap((s) => s.episodes), ...data.loose] : [];
  const options = all.filter((e) => !present.has(e.id));
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api(`/api/characters/${c.id}/appearances/${pick}`, { method: 'PUT' });
    if (r.ok) { setPick(''); setError(null); reload(); } else setError(apiError(r.erreur));
  };
  const remove = async (episodeId: string) => { const r = await api(`/api/characters/${c.id}/appearances/${episodeId}`, { method: 'DELETE' }); if (r.ok) reload(); else setError(apiError(r.erreur)); };
  return (
    <section className="card" aria-labelledby="app">
      <h2 id="app">Épisodes d'apparition</h2>
      <p className="muted">Renseignés manuellement : l'application n'analyse pas les scénarios.</p>
      {c.appearances.length === 0 ? <p className="empty">Aucune apparition renseignée.</p> : (
        <ul className="doclist">
          {c.appearances.map((a) => (
            <li key={a.episodeId} className="row spread">
              <a href={`#/saisons/e/${a.episodeId}`}><span className="code">{a.code}</span> {episodeTitle(a)}</a>
              {c.canWrite && <button className="btn secondary" onClick={() => remove(a.episodeId)}>Retirer</button>}
            </li>
          ))}
        </ul>
      )}
      {c.canWrite && options.length > 0 && (
        <form className="row" onSubmit={add}>
          <select aria-label="Épisode d'apparition" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Ajouter un épisode…</option>
            {options.map((e) => <option key={e.id} value={e.id}>{e.code} — {episodeTitle(e)}</option>)}
          </select>
          <button className="btn" type="submit" disabled={!pick}>Ajouter</button>
        </form>
      )}
    </section>
  );
}

/** Personnages présents dans un épisode (section de la fiche épisode). */
export function EpisodeCharacters({ episodeId, present, canWrite, reload, setError }: { episodeId: string; present: { id: string; name: string; photoImageId: string | null }[]; canWrite: boolean; reload: () => void; setError: (m: string | null) => void }) {
  const [all, setAll] = useState<CharacterCard[]>([]);
  const [pick, setPick] = useState('');
  useEffect(() => { if (canWrite) api<CharacterCard[]>('/api/characters').then((r) => r.ok && setAll(r.data)); }, [canWrite]);
  const ids = new Set(present.map((p) => p.id));
  const options = all.filter((c) => !ids.has(c.id));
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api(`/api/characters/${pick}/appearances/${episodeId}`, { method: 'PUT' });
    if (r.ok) { setPick(''); setError(null); reload(); } else setError(apiError(r.erreur));
  };
  const remove = async (id: string) => { const r = await api(`/api/characters/${id}/appearances/${episodeId}`, { method: 'DELETE' }); if (r.ok) reload(); else setError(apiError(r.erreur)); };
  return (
    <section className="card" aria-labelledby="chars">
      <h2 id="chars">Personnages présents</h2>
      {present.length === 0 ? <p className="empty">Aucun personnage renseigné pour cet épisode.</p> : (
        <ul className="chips">
          {present.map((p) => (
            <li key={p.id}><a href={`#/personnages/${p.id}`}><Avatar id={p.photoImageId} name={p.name} size={28} /> {p.name}</a>{canWrite && <button className="link" onClick={() => remove(p.id)} aria-label={`Retirer ${p.name}`}>✕</button>}</li>
          ))}
        </ul>
      )}
      {canWrite && options.length > 0 && (
        <form className="row" onSubmit={add}>
          <select aria-label="Personnage présent" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Ajouter un personnage…</option>
            {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn" type="submit" disabled={!pick}>Ajouter</button>
        </form>
      )}
    </section>
  );
}
