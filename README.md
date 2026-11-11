# Ma série — application de gestion de série TV

Application web privée (une seule série) qui complète Google Docs : organisation, consultation, relations entre éléments, collaboration. Coût d'exploitation visé : **0 €**.

**État : phase 3 (interface et navigation).** Voir `CHANGELOG.md`.

## Pile technique

React + TypeScript + Vite (frontend) · Hono sur Cloudflare Workers (API) · Cloudflare D1 (base SQLite) · Google OAuth. Détails et justifications : `docs/ARCHITECTURE.md`.

## Installation locale

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm test            # tests unitaires (logique de sécurité, schéma SQL)
npm run typecheck
npm run build
```

Pour lancer l'application complète en local, créez un fichier `.dev.vars` (ignoré par Git) :

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

puis `npm run db:migrate:local`, `npx wrangler dev` et `npm run dev`. Configuration des services : `docs/DEPLOYMENT.md` et `docs/GOOGLE_INTEGRATION.md`.

## Documentation

| Fichier | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | Architecture et choix techniques |
| `docs/DATABASE.md` | Modèle de données |
| `docs/SECURITY.md` | Sécurité et permissions |
| `docs/GOOGLE_INTEGRATION.md` | Configuration Google |
| `docs/DEPLOYMENT.md` | Déploiement et limites des offres gratuites |
| `CHANGELOG.md` | Historique des modifications |

`BACKUP.md` et `USER_GUIDE.md` seront rédigés avec les fonctionnalités concernées (phases 12 et suivantes).
