import { useEffect, useMemo, useRef, useState } from 'react';
import { api, CATEGORY_LABEL, STATUS_LABEL, type DocItem } from '../api.ts';
import { sanitizeDocHtml } from '../sanitize.ts';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Liste des documents importés (aucun bouton de téléchargement ; ouverture dans Google Docs uniquement). */
export function DocumentList() {
  const [docs, setDocs] = useState<DocItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { api<DocItem[]>('/api/documents').then((r) => (r.ok ? setDocs(r.data) : setError(true))); }, []);

  return (
    <>
      <h1>Documents généraux</h1>
      <p className="muted">Documents Google Docs importés. Leur contenu reste dans Google Drive ; il est lu à la demande avec votre compte Google.</p>
      {error && <div className="alert" role="alert">Impossible de charger les documents.</div>}
      {!docs && !error && <p className="muted">Chargement…</p>}
      {docs && docs.length === 0 && <div className="card empty-state"><p>Aucun document importé pour l'instant.</p><p className="muted">Un administrateur ou un éditeur peut en importer depuis <a href="#/parametres/drive">Paramètres → Google Drive</a>.</p></div>}
      {docs && docs.length > 0 && (
        <ul className="doclist card">
          {docs.map((d) => (
            <li key={d.id} className="row spread">
              <span>
                {d.viewable ? <a href={`#/documents/${d.id}`}>{d.title}</a> : <span>{d.title}</span>}
                {d.category && <span className="badge">{CATEGORY_LABEL[d.category] ?? d.category}</span>}
                {d.status !== 'ok' && <span className="warn" role="note">⚠ {STATUS_LABEL[d.status] ?? d.status}</span>}
              </span>
              <small className="muted">Modifié le {when(d.modifiedTime)}</small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Loaded = { html: string; title: string; openUrl: string | null };

/** Lecteur : contenu assaini (liste blanche), affiché sans scripts ni styles externes, avec confort de lecture et recherche. */
export function DocumentReader({ id }: { id: string }) {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState(() => { try { return Number(localStorage.getItem('reader.size')) || 100; } catch { return 100; } });
  const [serif, setSerif] = useState(() => { try { return localStorage.getItem('reader.serif') === '1'; } catch { return false; } });
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDoc(null); setError(null);
    api<Loaded>(`/api/documents/${encodeURIComponent(id)}/content`).then((r) => {
      if (r.ok) setDoc(r.data);
      else setError(r.message ?? 'Ce document ne peut pas être affiché pour le moment.');
    });
  }, [id]);

  const html = useMemo(() => (doc ? sanitizeDocHtml(doc.html) : ''), [doc]);
  useEffect(() => { try { localStorage.setItem('reader.size', String(size)); localStorage.setItem('reader.serif', serif ? '1' : '0'); } catch { /* facultatif */ } }, [size, serif]);

  // Recherche dans le texte : surligne via la sélection du navigateur, sans modifier le contenu.
  const find = (backwards = false) => {
    if (!q) return;
    (window as unknown as { find?: (...a: unknown[]) => boolean }).find?.(q, false, backwards, true);
  };

  return (
    <>
      <p><a href="#/documents">← Documents</a></p>
      {error && <div className="alert" role="alert">{error}</div>}
      {!doc && !error && <p className="muted">Chargement du document…</p>}
      {doc && (
        <>
          <h1>{doc.title}</h1>
          <div className="reader-tools row" role="toolbar" aria-label="Confort de lecture">
            <button className="btn secondary" onClick={() => setSize(Math.max(80, size - 10))} aria-label="Réduire le texte">A−</button>
            <button className="btn secondary" onClick={() => setSize(Math.min(160, size + 10))} aria-label="Agrandir le texte">A+</button>
            <button className="btn secondary" aria-pressed={serif} onClick={() => setSerif(!serif)}>Police à empattements</button>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find(e.shiftKey)} placeholder="Rechercher dans le texte" aria-label="Rechercher dans le texte" />
            {doc.openUrl && <a className="btn secondary" href={doc.openUrl} target="_blank" rel="noopener noreferrer">Ouvrir dans Google Docs</a>}
          </div>
          <article ref={box} className={`reader card${serif ? ' serif' : ''}`} style={{ fontSize: `${size}%` }} dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
    </>
  );
}
