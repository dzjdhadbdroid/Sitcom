# Configuration Google

## Phase 2 : connexion uniquement
1. Console Google Cloud : créer un projet. **N'activez jamais la facturation.**
2. « Écran de consentement OAuth » : type **Externe**, nom de l'application, votre adresse comme contact.
3. Portées : `openid`, `email`, `profile` (non sensibles, aucune vérification Google requise).
4. « Identifiants » → Créer un « ID client OAuth » de type **Application Web**.
   - URI de redirection autorisée : `https://<votre-adresse>.workers.dev/api/auth/callback` (et `http://localhost:8787/api/auth/callback` pour le local).
5. Conservez l'ID client et le secret : ils se déposent comme **secrets Cloudflare** (voir `DEPLOYMENT.md`), jamais dans le dépôt.

Avec ces seules portées, l'application peut rester en mode « Test » sans que les connexions expirent au bout de 7 jours (cette expiration ne concerne que les portées sensibles ou restreintes, ajoutées en phase 4).

## Phase 4 (prévu)
Ajout de la portée Drive en lecture (voie A de l'architecture : accès global, avertissement Google « application non vérifiée », 100 utilisateurs maximum). La durée réelle de validité des autorisations sera testée avant de valider ce choix ; repli prévu sur `drive.file` + Google Picker.
