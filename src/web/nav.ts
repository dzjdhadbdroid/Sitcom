export interface NavItem { path: string; label: string; icon: string }

// Rubriques du menu principal, dans l'ordre du cahier des charges (pas de rubrique « Intrigues »).
export const NAV: NavItem[] = [
  { path: '', label: 'Tableau de bord', icon: 'home' },
  { path: 'saisons', label: 'Saisons', icon: 'seasons' },
  { path: 'personnages', label: 'Personnages', icon: 'characters' },
  { path: 'univers', label: 'Univers', icon: 'universe' },
  { path: 'chronologie', label: 'Chronologie', icon: 'timeline' },
  { path: 'idees', label: 'Idées', icon: 'ideas' },
  { path: 'documents', label: 'Documents généraux', icon: 'documents' },
  { path: 'archives', label: 'Archives', icon: 'archive' },
  { path: 'parametres', label: 'Paramètres', icon: 'settings' },
];

// Barre du bas sur smartphone : les 4 rubriques les plus utilisées + « Plus » (ouvre le menu complet).
export const MOBILE_TABS: string[] = ['', 'saisons', 'personnages', 'idees'];

export const SECTION_INFO: Record<string, { title: string; text: string; phase: number }> = {
  saisons: { title: 'Saisons et épisodes', text: 'Vos saisons, leurs épisodes, leurs statuts et les scénarios Google Docs associés.', phase: 5 },
  personnages: { title: 'Personnages', text: 'Fiches détaillées, relations entre personnages et apparitions dans les épisodes.', phase: 6 },
  univers: { title: 'Univers', text: "Les lieux, les règles et les informations importantes de l'univers de la série.", phase: 7 },
  chronologie: { title: 'Chronologie', text: "Les événements de l'histoire, en frise visuelle ou en liste.", phase: 8 },
  idees: { title: 'Idées', text: 'Votre banque d’idées : gags, situations, dialogues, concepts.', phase: 8 },
  documents: { title: 'Documents généraux', text: 'Références et médias présents dans Google Drive, classés par dossiers et catégories.', phase: 9 },
  archives: { title: 'Archives', text: 'Les éléments archivés, consultables et restaurables.', phase: 12 },
};
