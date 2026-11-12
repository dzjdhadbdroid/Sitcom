# Architecture

```
Navigateur (React) ── HTTPS, cookie HttpOnly ──> Cloudflare Worker (Hono)
                                                   ├─ /api/auth/*  OAuth Google, sessions
                                                   ├─ /api/admin/* invitations, membres, permissions
                                                   └─ fichiers statiques (frontend compilé)
                                                          │
                                                   Cloudflare D1 (SQLite)
```

Le Worker sert aussi le frontend : une seule origine, donc cookies de première partie et protection CSRF simple (contrôle de l'en-tête `Origin`).

## Organisation du code

| Dossier | Rôle |
|---|---|
| `src/lib` | Logique métier sans dépendance externe : permissions, invitations, sessions, connexion, chiffrement. Testée avec SQLite local. |
| `src/worker` | Routes HTTP (Hono). Aucune règle métier : elle appelle `src/lib`. |
| `src/web` | Interface React. |
| `migrations` | Schéma SQL versionné. |
| `tests` | Tests Node (`node --test`) contre le vrai schéma. |

## Choix principaux

- **D1 plutôt que Supabase** : pas de mise en pause pour inactivité, pas de carte bancaire. Limite : 500 Mo par base (offre gratuite).
- **Logique dans `src/lib` derrière une interface `DB` minimale** : elle se teste avec `node:sqlite` sans émulateur Cloudflare.
- **Permissions sur un arbre de ressources** : voir `docs/SECURITY.md`.

## Interface (phase 3)
- Routage par ancre (`#/saisons`) : aucune configuration serveur nécessaire.
- Navigation : menu fixe au-dessus de 1024 px, tiroir entre 640 et 1023 px, barre du bas (4 rubriques + « Plus ») sous 640 px.
- Thème : variables CSS ; `data-theme` force clair/sombre, sinon suivi du système. Couleur de la série : `--accent`, texte de contraste calculé.
- Contrôle visuel : `tests/visual/check.cjs` (Chrome, serveur simulé avec données fictives, 3 tailles × 2 thèmes). Il vérifie l'absence de débordement, la navigation, les formulaires et les droits ; il n'est pas lancé par la CI.

## Phase 4 : Drive
Modules `src/lib/drive.ts` (client GET-only), `drive-connection.ts` (jeton chiffré), `drive-sync.ts` (dossiers, import, synchronisation, lecture). Le Worker expose `/api/drive/*` et `/api/documents*` et un gestionnaire `scheduled`. Le frontend ajoute l'onglet Paramètres → Google Drive, la liste et le lecteur de documents.

## Phase 5 : saisons et épisodes
`src/lib/seasons.ts` (logique et validations, toutes les opérations passent par `can()`/`readableIds()`), routes `/api/seasons*` et `/api/episodes*`, pages `Seasons.tsx` (liste/cartes, fiche épisode). Déplacer un épisode exige l'écriture sur la saison de destination ; une réorganisation laisse en place les éléments que l'utilisateur ne voit pas.
