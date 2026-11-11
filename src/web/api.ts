export interface Me { userId: string; email: string; name: string | null; picture: string | null; role: 'admin' | 'editor' | 'reader'; isOwner: boolean }
export interface Series {
  title: string; genre: string | null; format: string | null; summary: string | null; plannedSeasons: number | null;
  avgDurationMin: number | null; audience: string | null; inspirations: string | null; notes: string | null;
  accentColor: string | null; updatedAt: string | null;
}
export interface Dashboard {
  members: { total: number; admins: number; editors: number; readers: number };
  recentActivity: { id: string; action: string; actorName: string | null; createdAt: string }[] | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; erreur: string };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, erreur: (body as { erreur?: string }).erreur ?? 'erreur' };
  } catch {
    return { ok: false, status: 0, erreur: 'reseau' };
  }
}

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrateur', editor: 'Éditeur', reader: 'Lecteur' };

export const API_ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas le droit d'effectuer cette action.",
  reseau: 'Connexion au serveur impossible. Vérifiez votre connexion et réessayez.',
  invalid_email: 'Adresse e-mail invalide.', invalid_role: 'Rôle invalide.',
  already_member: 'Cette personne est déjà membre.', already_pending: 'Une invitation est déjà en attente pour cette adresse.',
  not_pending: "Cette invitation n'est plus en attente.",
  invalid_title: 'Le titre est obligatoire (200 caractères maximum).',
  invalid_plannedSeasons: 'Le nombre de saisons doit être un entier entre 1 et 99.',
  invalid_avgDurationMin: 'La durée doit être un entier entre 1 et 600 minutes.',
  invalid_accentColor: 'Couleur invalide.',
  nothing_to_update: 'Aucune modification à enregistrer.',
  erreur_interne: 'Une erreur est survenue. Réessayez dans un instant.',
};
export const apiError = (code: string) => API_ERRORS[code] ?? 'Une erreur est survenue.';

const ACTION_LABEL: Record<string, string> = {
  'owner.initialized': 'Administrateur principal initialisé',
  'invitation.created': 'Invitation créée',
  'invitation.cancelled': 'Invitation annulée',
  'invitation.accepted': 'Invitation acceptée',
  'member.role_changed': "Rôle d'un membre modifié",
  'member.removed': 'Membre retiré',
  'permission.changed': 'Permissions modifiées',
  'series.updated': 'Fiche de la série modifiée',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
