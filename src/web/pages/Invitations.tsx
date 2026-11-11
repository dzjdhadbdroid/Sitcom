import { useCallback, useEffect, useState } from 'react';
import { api, apiError, ROLE_LABEL } from '../api.ts';

interface Invitation { id: string; email: string; role: string; created_at: string; expires_at: string }

export function Invitations() {
  const [list, setList] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reader');
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Invitation[]>('/api/admin/invitations');
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null); setLink(null); setCopied(false);
    const r = await api<{ lien: string }>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
    if (!r.ok) return setMessage(apiError(r.erreur));
    setLink(r.data.lien); setEmail(''); void load();
  };

  const cancel = async (id: string) => {
    if (!confirm('Annuler cette invitation ?')) return;
    const r = await api(`/api/admin/invitations/${id}`, { method: 'DELETE' });
    if (!r.ok) setMessage(apiError(r.erreur));
    void load();
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link ?? ''); setCopied(true); } catch { setMessage('Copie impossible : sélectionnez le lien et copiez-le manuellement.'); }
  };

  return (
    <section className="card">
      <h2>Inviter un collaborateur</h2>
      <form onSubmit={create} className="row">
        <input type="email" required placeholder="adresse Google de la personne" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Adresse e-mail" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rôle">
          {Object.entries(ROLE_LABEL).reverse().map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit">Créer l'invitation</button>
      </form>
      {message && <div className="alert" role="alert">{message}</div>}
      {link && (
        <div className="invite-link">
          <p className="muted">Transmettez ce lien à la personne. Il est valable 7 jours et n'est affiché qu'une seule fois.</p>
          <div className="link">{link}</div>
          <button className="secondary" onClick={copy}>{copied ? 'Lien copié ✓' : 'Copier le lien'}</button>
        </div>
      )}
      <h3>Invitations en attente</h3>
      {list.length === 0 && <p className="empty">Aucune invitation en attente.</p>}
      {list.map((i) => (
        <div className="row spread" key={i.id}>
          <span>{i.email} <small>· {ROLE_LABEL[i.role]} · expire le {new Date(i.expires_at).toLocaleDateString('fr-FR')}</small></span>
          <button className="danger" onClick={() => cancel(i.id)}>Annuler</button>
        </div>
      ))}
    </section>
  );
}
