# Modèle de données (phase 2)

Migration : `migrations/0001_init.sql`. Dates en ISO 8601 UTC. Les tables de contenu (saisons, épisodes, personnages...) arrivent avec leurs phases.

| Table | Rôle |
|---|---|
| `series` | Une seule ligne (`id = 'main'`). |
| `resources` | Arbre de ressources (série → rubrique → saison → épisode → élément) servant aux permissions. Chaque entité de contenu y aura une ligne de même identifiant. `archived_at` prépare l'archivage. |
| `users` | Comptes (identifiant Google `google_sub`, adresse unique insensible à la casse). |
| `memberships` | Rôle (`admin`, `editor`, `reader`), `is_owner` (un seul propriétaire, garanti par un index unique), `removed_at` (désactivation, jamais de suppression). |
| `invitations` | Jeton **haché** (`token_hash`), expiration, usage unique ; une seule invitation en attente par adresse. |
| `grants` | Exceptions de permission (`none`, `read`, `write`) par utilisateur et par ressource. |
| `sessions` | Identifiant = hachage SHA-256 du jeton de cookie, avec expiration. |
| `activity_log` | Journal : auteur, action, élément, détails (JSON sans secret), date. |
| `notifications` | Notifications dans l'application. |

Les identifiants sont des UUID, jamais des numéros affichés.

## Phase 3 : migration `0002_series_profile.sql`
Colonnes ajoutées à `series` : `genre`, `format`, `summary`, `planned_seasons`, `avg_duration_min`, `audience`, `inspirations`, `notes`, `accent_color` (`#rrggbb`), `updated_at`. Le journal d'activité conserve les noms des champs modifiés, jamais leur contenu.

## Phase 4 : migration `0003_drive.sql`
- `drive_connections` : une ligne par utilisateur (jeton de renouvellement **chiffré**, portée, statut `active`/`reauth_required`, curseur `page_token` de l'API Changes, dernière synchronisation/erreur).
- `drive_sync_folders` : dossiers surveillés par utilisateur.
- `drive_documents` : références de documents (`state` = `available` ou `imported`, catégorie, rubrique, statut `ok`/`trashed`/`removed`/`moved_out`). Un document importé est aussi une ressource `item` de l'arbre des permissions. **Aucun contenu de document n'est stocké.**

## Phase 5 : migration `0004_seasons_episodes.sql`
- `seasons` (numéro affiché modifiable et non unique, position, `finished_at` manuel) et `episodes` (`season_id` nul = hors saison, `kind`, `number`, `status` ∈ idée/écriture/terminé/validé, durée, position). Chacun possède une ligne `resources` de même identifiant (permissions hiérarchiques : épisode → saison → rubrique).
- `episode_documents` : liens épisode ↔ document importé ; index unique partiel garantissant au plus un scénario principal par épisode.
- L'archivage pose `resources.archived_at` ; rien n'est supprimé.
