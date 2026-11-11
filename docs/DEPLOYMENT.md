# Déploiement (0 €)

À faire par vous (je ne peux pas créer vos comptes) :

## 1. Comptes
- GitHub (dépôt **privé**), Cloudflare (**ne saisissez aucune carte bancaire**), projet Google Cloud sans facturation.

## 2. Dépôt
Créez un dépôt privé vide, puis poussez ce dossier : `git remote add origin <url>` · `git push -u origin main`.

## 3. Base de données
```bash
npx wrangler login
npx wrangler d1 create serie-db        # copiez database_id dans wrangler.toml
npm run db:migrate:remote
```

## 4. Configuration
- Dans `wrangler.toml` : `OWNER_EMAIL` = votre adresse Google (administrateur principal).
- Secrets (saisie masquée, jamais dans Git) :
  ```bash
  npx wrangler secret put GOOGLE_CLIENT_ID
  npx wrangler secret put GOOGLE_CLIENT_SECRET
  npx wrangler secret put TOKEN_ENCRYPTION_KEY   # voir GOOGLE_INTEGRATION.md pour la génération
  ```

## 5. Déploiement automatique
Cloudflare → Workers & Pages → importer le dépôt GitHub → commande de build `npm run build`, commande de déploiement `npx wrangler deploy`. Chaque fusion sur `main` est ensuite publiée automatiquement. L'action GitHub `CI` vérifie les tests avant fusion.

## Variables d'environnement
| Nom | Type | Rôle |
|---|---|---|
| `OWNER_EMAIL` | variable | Administrateur principal |
| `GOOGLE_CLIENT_ID` | secret | OAuth Google |
| `GOOGLE_CLIENT_SECRET` | secret | OAuth Google |
| `TOKEN_ENCRYPTION_KEY` | secret | Chiffrement des jetons Drive (32 octets base64url) |

## Limites des offres gratuites (vérifiées en novembre 2026)
- Workers : 100 000 requêtes/jour ; au-delà, erreurs, pas de facturation tant que le plan payant n'est pas activé.
- D1 : 500 Mo par base, 5 Go par compte ; quotas quotidiens de lectures/écritures de lignes, appliqués par des erreurs jusqu'à minuit UTC.
- Limites exactes de lignes lues/écrites par jour et temps CPU des Workers : **à confirmer dans la documentation Cloudflare** avant la mise en production.
- Ne passez jamais au plan Workers payant sans décision explicite.
- Tâche planifiée (Cron Trigger, `*/15 * * * *`) : gratuite, mais soumise aux limites de sous-requêtes et de temps CPU des Workers (50 sous-requêtes par exécution gratuite) : la synchronisation est donc découpée par budget et reprend à l'exécution suivante. À confirmer en conditions réelles.
