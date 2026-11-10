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
