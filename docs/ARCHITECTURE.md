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
