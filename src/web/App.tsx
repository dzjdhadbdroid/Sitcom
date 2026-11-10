import { useCallback, useEffect, useState } from 'react';

interface Me { userId: string; email: string; name: string | null; role: 'admin' | 'editor' | 'reader'; isOwner: boolean }
interface Invitation { id: string; email: string; role: string; created_at: string; expires_at: string }

const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', editor: 'Éditeur', reader: 'Lecteur' };
const ERRORS: Record<string, string> = {
  not_invited: "Cette adresse Google n'a pas été invitée. Demandez une invitation à l'administrateur.",
  invitation_unusable: "Cette invitation est expirée, annulée ou déjà utilisée. Demandez-en une nouvelle.",
  google_account_mismatch: "Cette adresse est déjà liée à un autre compte Google.",
  email_not_verified: "L'adresse e-mail de ce compte Google n'est pas vérifiée.",
  session_expiree: 'La tentative de connexion a expiré. Réessayez.',
  connexion_refusee: 'La connexion Google a été refusée ou interrompue.',
  echange_impossible: 'La connexion avec Google a échoué. Réessayez dans un instant.',
  jeton_invalide: 'La réponse de Google est invalide. Réessayez.',
  internal_error: 'Une erreur interne est survenue. Réessayez.',
};
const API_ERRORS: Record<string, string> = {
  forbidden: 'Action non autorisée.', invalid_email: 'Adresse e-mail invalide.', invalid_role: 'Rôle invalide.',
  already_member: 'Cette personne est déjà membre.', already_pending: 'Une invitation est déjà en attente pour cette adresse.',
  not_pending: "Cette invitation n'est plus en attente.",
};

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; erreur: string }> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, erreur: (body as { erreur?: string }).erreur ?? 'erreur' };
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const params = new URLSearchParams(location.search);
  const erreur = params.get('erreur');
  const invite = params.get('invite');

  useEffect(() => {
    api<Me>('/api/me').then((r) => setMe(r.ok ? r.data : null));
  }, []);

  if (me === undefined) return <main><p className="muted">Chargement…</p></main>;

  if (!me) {
    return (
      <main>
        <div className="card">
          <h1>Ma série</h1>
          <p className="muted">Espace privé de gestion. L'accès se fait uniquement sur invitation, avec votre compte Google.</p>
          {erreur && <div className="alert" role="alert">{ERRORS[erreur] ?? 'Connexion impossible.'}</div>}
          <a className="btn" href={`/api/auth/login${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`}>Se connecter avec Google</a>
        </div>
      </main>
    );
  }

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/';
  };

  return (
    <main>
      <div className="card">
        <h1>Bienvenue{me.name ? `, ${me.name}` : ''}</h1>
        <p className="muted">{me.email} · {ROLE_LABEL[me.role]}{me.isOwner ? ' (propriétaire)' : ''}</p>
        <p className="muted">Les rubriques de la série arrivent dans les prochaines phases.</p>
        <button className="secondary" onClick={logout}>Se déconnecter</button>
      </div>
      {me.role === 'admin' && <Invitations />}
    </main>
  );
}

function Invitations() {
  const [list, setList] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('reader');
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Invitation[]>('/api/admin/invitations');
    if (r.ok) setList(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null); setLink(null);
    const r = await api<{ lien: string }>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ email, role }) });
    if (!r.ok) return setMessage(API_ERRORS[r.erreur] ?? 'Erreur.');
    setLink(r.data.lien); setEmail(''); void load();
  };

  const cancel = async (id: string) => {
    if (!confirm('Annuler cette invitation ?')) return;
    const r = await api(`/api/admin/invitations/${id}`, { method: 'DELETE' });
    if (!r.ok) setMessage(API_ERRORS[r.erreur] ?? 'Erreur.');
    void load();
  };

  return (
    <div className="card">
      <h2>Inviter un collaborateur</h2>
      <form onSubmit={create} className="row">
        <input type="email" required placeholder="adresse Google" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Adresse e-mail" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rôle">
          <option value="reader">Lecteur</option><option value="editor">Éditeur</option><option value="admin">Administrateur</option>
        </select>
        <button type="submit">Créer l'invitation</button>
      </form>
      {message && <div className="alert" role="alert">{message}</div>}
      {link && (
        <div>
          <p className="muted">Transmettez ce lien à la personne (valable 7 jours, affiché une seule fois) :</p>
          <div className="link">{link}</div>
          <button className="secondary" onClick={() => navigator.clipboard.writeText(link)}>Copier le lien</button>
        </div>
      )}
      <h2 style={{ marginTop: 20 }}>Invitations en attente</h2>
      {list.length === 0 && <p className="muted">Aucune invitation en attente.</p>}
      {list.map((i) => (
        <div className="row" key={i.id}>
          <span>{i.email} · {ROLE_LABEL[i.role]} · expire le {new Date(i.expires_at).toLocaleDateString('fr-FR')}</span>
          <button className="danger" onClick={() => cancel(i.id)}>Annuler</button>
        </div>
      ))}
    </div>
  );
}
