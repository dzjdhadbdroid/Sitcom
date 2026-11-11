import { useCallback, useEffect, useState } from 'react';
import { api, apiError, CATEGORY_LABEL, DOC_SECTIONS, type DocItem, type DriveStatus } from '../api.ts';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');
const DRIVE_FLASH: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: 'Google Drive est connecté (lecture seule).' },
  refuse: { ok: false, text: "L'autorisation a été refusée ou interrompue. Rien n'a été connecté." },
  expire: { ok: false, text: 'La tentative a expiré. Réessayez.' },
  echec: { ok: false, text: 'La connexion avec Google a échoué. Réessayez dans un instant.' },
  autre_compte: { ok: false, text: "Ce n'est pas le compte Google avec lequel vous êtes connecté à l'application. Choisissez le même compte." },
  portee: { ok: false, text: "L'accès en lecture seule à Drive n'a pas été accordé. Cochez la case correspondante sur l'écran Google." },
};

interface Folder { id: string; name: string }

export function DriveSettings() {
  const [st, setSt] = useState<DriveStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(() => {
    const code = new URLSearchParams(location.hash.split('?')[1] ?? '').get('drive');
    return code ? DRIVE_FLASH[code] ?? null : null;
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<DriveStatus>('/api/drive/status');
    if (r.ok) setSt(r.data); else setMsg({ ok: false, text: apiError(r.erreur) });
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!st) return <p className="muted">Chargement…</p>;
  const c = st.connection;

  const sync = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ ok: boolean; newDocuments: number; modified: number; statusChanged: number; complete: boolean }>('/api/drive/sync', { method: 'POST' });
    setBusy(false);
    if (r.ok) setMsg({ ok: true, text: `Synchronisation terminée : ${r.data.newDocuments} nouveau(x), ${r.data.modified} modifié(s), ${r.data.statusChanged} avertissement(s).${r.data.complete ? '' : ' Il reste des changements : relancez dans un instant.'}` });
    else setMsg({ ok: false, text: 'La synchronisation a échoué. Aucune donnée n’a été supprimée ; une nouvelle tentative aura lieu automatiquement.' });
    void load();
  };
  const disconnect = async () => {
    if (!confirm('Déconnecter Google Drive ? Les documents déjà référencés dans l’application et leur classement sont conservés ; seule la lecture du contenu est suspendue.')) return;
    await api('/api/drive/connection', { method: 'DELETE' });
    void load();
  };

  return (
    <>
      {msg && <div className={msg.ok ? 'notice' : 'alert'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <section className="card">
        <h2>Connexion</h2>
        <p className="muted">L'accès à Google Drive est en <strong>lecture seule</strong> : l'application ne peut ni modifier, ni déplacer, ni supprimer vos fichiers, ni changer leurs partages. Elle ne copie pas le contenu de vos documents.</p>
        {!c && (st.canConnect
          ? <a className="btn" href="/api/drive/connect">Connecter Google Drive</a>
          : <p className="muted">Seuls les administrateurs et les éditeurs peuvent connecter Google Drive.</p>)}
        {c && (
          <>
            <p>
              État : <span className="badge">{c.status === 'active' ? 'Connecté' : 'Reconnexion nécessaire'}</span>
              {' '}· Dernière synchronisation : {when(c.lastSyncAt)}
            </p>
            {c.status === 'reauth_required' && <div className="alert" role="alert">L'autorisation a expiré ou a été retirée. Reconnectez votre Drive pour reprendre la synchronisation. Vos documents et leur classement sont conservés.</div>}
            {c.lastError && c.status === 'active' && <div className="alert" role="alert">Dernière synchronisation en échec (Google momentanément indisponible ou limité). Une nouvelle tentative aura lieu automatiquement.</div>}
            <div className="row">
              {c.status === 'reauth_required' ? <a className="btn" href="/api/drive/connect">Reconnecter Google Drive</a> : <button className="btn" onClick={sync} disabled={busy}>{busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>}
              <button className="btn secondary" onClick={disconnect}>Déconnecter</button>
            </div>
          </>
        )}
      </section>
      {c?.status === 'active' && <Folders st={st} reload={load} />}
      {c?.status === 'active' && st.folders.length > 0 && <Import />}
    </>
  );
}

function Folders({ st, reload }: { st: DriveStatus; reload: () => void }) {
  const [trail, setTrail] = useState<Folder[]>([{ id: 'root', name: 'Mon Drive' }]);
  const [list, setList] = useState<Folder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const here = trail[trail.length - 1];

  useEffect(() => {
    setList(null); setErr(null);
    api<Folder[]>(`/api/drive/folders?parent=${encodeURIComponent(here.id)}`).then((r) => (r.ok ? setList(r.data) : setErr((r as { erreur: string }).erreur === 'auth_revoked' ? 'Reconnexion nécessaire.' : 'Impossible de lister les dossiers pour le moment.')));
  }, [here.id]);

  const add = async (f: Folder) => {
    const r = await api('/api/drive/sync-folders', { method: 'POST', body: JSON.stringify({ folderId: f.id }) });
    if (!r.ok) setErr(apiError(r.erreur)); else reload();
  };
  const remove = async (folderId: string) => {
    if (!confirm('Ne plus synchroniser ce dossier ? Les documents déjà importés sont conservés.')) return;
    await api(`/api/drive/sync-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' });
    reload();
  };
  const watched = new Set(st.folders.map((f) => f.folderId));

  return (
    <section className="card">
      <h2>Dossiers synchronisés</h2>
      <p className="muted">Choisissez les dossiers à surveiller. Rien n'est importé automatiquement : vous sélectionnez ensuite les documents à importer.</p>
      {st.folders.length === 0 ? <p className="empty">Aucun dossier choisi pour l'instant.</p> : st.folders.map((f) => (
        <div className="row spread" key={f.id}><span>{f.name}</span><button className="btn secondary" onClick={() => remove(f.folderId)}>Retirer</button></div>
      ))}
      <h3>Parcourir mon Drive</h3>
      <nav className="crumbs" aria-label="Chemin">
        {trail.map((t, i) => <button key={t.id} className="link" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>{t.name}</button>)}
      </nav>
      {err && <div className="alert" role="alert">{err}</div>}
      {!list && !err && <p className="muted">Chargement…</p>}
      {list && list.length === 0 && <p className="empty">Aucun sous-dossier ici.</p>}
      {list?.map((f) => (
        <div className="row spread" key={f.id}>
          <button className="link" onClick={() => setTrail([...trail, f])}>{f.name}</button>
          {watched.has(f.id) ? <span className="badge">Synchronisé</span> : <button className="btn secondary" onClick={() => add(f)}>Synchroniser ce dossier</button>}
        </div>
      ))}
    </section>
  );
}

function Import() {
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [sel, setSel] = useState<Record<string, { category: string; sectionId: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh: boolean) => {
    setBusy(true);
    const r = await api<DocItem[]>(`/api/drive/available${refresh ? '?refresh=1' : ''}`);
    setBusy(false);
    if (r.ok) setDocs(r.data); else setMsg({ ok: false, text: apiError(r.erreur) });
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const toggle = (d: DocItem) => setSel((s) => {
    const n = { ...s };
    if (n[d.id]) delete n[d.id]; else n[d.id] = { category: 'script', sectionId: 'section:documents' };
    return n;
  });
  const ids = Object.keys(sel);
  const submit = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ imported: number }>('/api/drive/import', { method: 'POST', body: JSON.stringify({ items: ids.map((id) => ({ id, ...sel[id] })) }) });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: `${r.data.imported} document(s) importé(s).` }); setSel({}); void load(false); } else setMsg({ ok: false, text: apiError(r.erreur) });
  };

  return (
    <section className="card">
      <h2>Importer des documents</h2>
      <p className="muted">Cochez les documents à importer et choisissez leur catégorie et leur rubrique. Le classement est toujours manuel.</p>
      <div className="row"><button className="btn secondary" onClick={() => load(true)} disabled={busy}>Actualiser la liste</button></div>
      {msg && <div className={msg.ok ? 'notice' : 'alert'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {!docs ? <p className="muted">Chargement…</p> : docs.length === 0 ? <p className="empty">Aucun document disponible à importer dans les dossiers synchronisés.</p> : (
        <ul className="doclist">
          {docs.map((d) => (
            <li key={d.id}>
              <label className="check"><input type="checkbox" checked={!!sel[d.id]} onChange={() => toggle(d)} /> <span>{d.title}</span></label>
              {!d.viewable && <small className="muted"> (format non affichable dans l'application)</small>}
              {sel[d.id] && (
                <div className="row">
                  <select aria-label="Catégorie" value={sel[d.id].category} onChange={(e) => setSel({ ...sel, [d.id]: { ...sel[d.id], category: e.target.value } })}>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select aria-label="Rubrique" value={sel[d.id].sectionId} onChange={(e) => setSel({ ...sel, [d.id]: { ...sel[d.id], sectionId: e.target.value } })}>
                    {DOC_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {ids.length > 0 && <button className="btn" onClick={submit} disabled={busy}>Importer {ids.length} document{ids.length > 1 ? 's' : ''}</button>}
    </section>
  );
}
