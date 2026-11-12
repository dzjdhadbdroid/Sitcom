export interface Me { userId: string; email: string; name: string | null; picture: string | null; role: 'admin' | 'editor' | 'reader'; isOwner: boolean }
export interface Series {
  title: string; genre: string | null; format: string | null; summary: string | null; plannedSeasons: number | null;
  avgDurationMin: number | null; audience: string | null; inspirations: string | null; notes: string | null;
  accentColor: string | null; updatedAt: string | null;
}
export interface Dashboard {
  members: { total: number; admins: number; editors: number; readers: number };
  recentActivity: { id: string; action: string; actorName: string | null; createdAt: string }[] | null;
  episodes: { total: number; byStatus: Record<EpisodeStatus, number> };
  seasons: { id: string; number: number | null; title: string; total: number; completed: number; finished: boolean }[];
  recentDocuments: { id: string; title: string; category: string | null; modifiedTime: string | null; status: string }[];
}
export interface DriveStatus {
  connection: { status: 'active' | 'reauth_required'; lastSyncAt: string | null; lastError: string | null; connectedAt: string } | null;
  folders: { id: string; folderId: string; name: string; addedAt: string }[];
  canConnect: boolean;
}
export interface DocItem {
  id: string; driveFileId: string; title: string; mimeType: string; modifiedTime: string | null; webViewLink: string | null;
  state: 'available' | 'imported'; category: string | null; sectionId: string | null; status: string; statusDetail: string | null; viewable: boolean;
}
export const CATEGORY_LABEL: Record<string, string> = {
  script: 'Script', draft: 'Brouillon', notes: 'Notes', corrected: 'Version corrigée', reference: 'Référence', other: 'Autre',
};
export const DOC_SECTIONS: { id: string; label: string }[] = [
  { id: 'section:seasons', label: 'Saisons' }, { id: 'section:characters', label: 'Personnages' }, { id: 'section:universe', label: 'Univers' },
  { id: 'section:timeline', label: 'Chronologie' }, { id: 'section:ideas', label: 'Idées' }, { id: 'section:documents', label: 'Documents généraux' },
];
export const STATUS_LABEL: Record<string, string> = {
  ok: 'À jour', trashed: 'Dans la corbeille Google Drive', removed: 'Supprimé ou accès retiré', moved_out: 'Déplacé hors des dossiers synchronisés', inaccessible: 'Inaccessible',
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; erreur: string; message?: string };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, erreur: (body as { erreur?: string }).erreur ?? 'erreur', message: (body as { message?: string }).message };
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
  not_a_folder: "Cet élément n'est pas un dossier.", invalid_selection: 'Sélectionnez au moins un document.',
  invalid_category: 'Catégorie invalide.', invalid_section: 'Rubrique invalide.', nothing_to_import: 'Aucun document à importer (déjà importés ou introuvables).',
  invalid_summary: 'Texte trop long (5 000 caractères maximum).', invalid_number: 'Numéro invalide.', invalid_episode_count: 'Le nombre d’épisodes doit être compris entre 0 et 60.',
  invalid_kind: 'Type invalide.', invalid_status: 'Statut invalide.', invalid_duration: 'La durée doit être comprise entre 1 et 600 minutes.',
  season_not_found: 'Saison introuvable.', invalid_order: 'Ordre invalide : rechargez la page.', not_found: 'Élément introuvable ou déjà archivé.',
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
  'season.created': 'Saison créée', 'season.updated': 'Saison modifiée', 'season.reordered': 'Saisons réorganisées', 'season.archived': 'Saison archivée',
  'episode.created': 'Épisode créé', 'episode.updated': 'Épisode modifié', 'episode.reordered': 'Épisodes réorganisés', 'episode.archived': 'Épisode archivé',
  'episode.document_linked': 'Document associé à un épisode', 'episode.document_unlinked': 'Document détaché d’un épisode', 'episode.main_script_changed': 'Scénario principal modifié',
  'document.imported': 'Document importé', 'document.reclassified': 'Document reclassé',
  'drive.connected': 'Google Drive connecté', 'drive.disconnected': 'Google Drive déconnecté', 'drive.reauth_required': 'Reconnexion Google Drive requise',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;

export type EpisodeStatus = 'idea' | 'writing' | 'done' | 'validated';
export type EpisodeKind = 'regular' | 'pilot' | 'special' | 'bonus' | 'cut_scene';
export const STATUS_NAMES: Record<EpisodeStatus, string> = { idea: 'Idée', writing: 'En cours d’écriture', done: 'Terminé', validated: 'Validé' };
export const KIND_NAMES: Record<EpisodeKind, string> = { regular: 'Épisode', pilot: 'Pilote', special: 'Épisode spécial', bonus: 'Contenu bonus', cut_scene: 'Scène coupée' };
export interface EpisodeRow {
  id: string; seasonId: string | null; kind: EpisodeKind; number: number | null; code: string; title: string; summary: string | null;
  status: EpisodeStatus; durationMin: number | null; position: number; documentCount: number; hasMainScript: boolean;
}
export interface SeasonRow { id: string; number: number | null; title: string; summary: string | null; position: number; finishedAt: string | null; episodes: EpisodeRow[] }
export interface SeasonsData { seasons: SeasonRow[]; loose: EpisodeRow[] }
export interface EpisodeDoc { id: string; title: string; category: string | null; status: string; statusDetail: string | null; isMain: boolean; viewable: boolean; modifiedTime: string | null }
export interface EpisodeDetail extends EpisodeRow { seasonTitle: string | null; seasonNumber: number | null; documents: EpisodeDoc[]; canWrite: boolean }
export const episodeTitle = (e: { title: string }) => e.title || 'Sans titre';
