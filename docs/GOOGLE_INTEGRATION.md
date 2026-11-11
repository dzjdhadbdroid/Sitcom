# Configuration Google

## Phase 2 : connexion uniquement
1. Console Google Cloud : créer un projet. **N'activez jamais la facturation.**
2. « Écran de consentement OAuth » : type **Externe**, nom de l'application, votre adresse comme contact.
3. Portées : `openid`, `email`, `profile` (non sensibles, aucune vérification Google requise).
4. « Identifiants » → Créer un « ID client OAuth » de type **Application Web**.
   - URI de redirection autorisée : `https://<votre-adresse>.workers.dev/api/auth/callback` (et `http://localhost:8787/api/auth/callback` pour le local).
5. Conservez l'ID client et le secret : ils se déposent comme **secrets Cloudflare** (voir `DEPLOYMENT.md`), jamais dans le dépôt.

Avec ces seules portées, l'application peut rester en mode « Test » sans que les connexions expirent au bout de 7 jours (cette expiration ne concerne que les portées sensibles ou restreintes, ajoutées en phase 4).

## Phase 4 : Google Drive en lecture seule (voie A)
**Portée unique : `https://www.googleapis.com/auth/drive.readonly`.** L'application n'émet que des requêtes `GET` vers Drive (vérifié par un test) : aucune modification, aucun déplacement, aucune suppression, aucun changement de partage.

### Configuration
1. Dans l'écran de consentement : ajouter la portée `.../auth/drive.readonly` (portée *restreinte*). Ajouter les comptes autorisés comme « utilisateurs de test », ou publier en « Production » sans vérification (écran « application non vérifiée », 100 utilisateurs maximum).
2. Activer l'**API Google Drive** dans le projet (gratuit).
3. Ajouter l'URI de redirection `https://<votre-adresse>.workers.dev/api/drive/callback` à l'ID client existant.
4. Générer la clé de chiffrement des jetons (32 octets aléatoires, base64url) puis la déposer en secret :
   ```bash
   node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'))"
   npx wrangler secret put TOKEN_ENCRYPTION_KEY
   ```
   **Conservez cette clé dans votre gestionnaire de mots de passe** : si elle est perdue ou changée, les connexions Drive devront être refaites (rien d'autre n'est perdu).

### Fonctionnement
- Connexion Drive = demande d'autorisation **séparée** de la connexion à l'application, avec le même compte Google (vérifié par l'identifiant `sub`). Le jeton de renouvellement est chiffré (AES-GCM) en base ; il n'est jamais envoyé au navigateur ni écrit dans les journaux.
- Synchronisation : API « Changes » de Drive, tâche planifiée Cloudflare toutes les 15 minutes (gratuite) + mise à jour à l'ouverture de la liste des documents (au plus toutes les 2 minutes) + bouton manuel. Les notifications push de Google exigent un domaine vérifié et ne sont donc pas utilisées.
- **Import manuel uniquement** : la synchronisation détecte les documents des dossiers choisis, mais seul l'import explicite d'un éditeur ou d'un administrateur les rattache à une rubrique et une catégorie. Aucune classification automatique.
- Le contenu n'est **pas copié** : il est lu à la demande (export HTML Google Docs) avec le compte Google de la personne qui lit. Le droit applicatif et le droit Drive sont indépendants ; l'application affiche un message clair quand Drive refuse l'accès.
- Document supprimé, mis à la corbeille, déplacé hors des dossiers suivis ou devenu inaccessible : la référence, le titre et le classement sont **conservés** avec un avertissement visible. Une erreur Google, un quota ou une autorisation révoquée ne suppriment jamais de données (nouvelle tentative automatique, une seule notification).

### Points à valider avec un vrai compte (non testés ici)
- Durée de validité du jeton de renouvellement pour une application non vérifiée avec portée restreinte : en mode « Test » Google l'expire au bout de 7 jours. Si cela se produit, l'écran affiche « Reconnexion nécessaire » ; la décision définitive (publier en production non vérifiée, ou repli sur `drive.file` + Google Picker) se prend après ce test.
- Fidélité de l'export HTML des scripts réels (mise en page, images, très longs documents, limite d'export de 10 Mo).
- Les tests automatiques utilisent un **faux Google** : ils prouvent la logique de l'application, pas le comportement réel de Google.
