# Sécurité et permissions

## Authentification
- Connexion exclusivement par Google OAuth 2.0 (code d'autorisation + PKCE + paramètre `state`). Aucun mot de passe.
- Portées demandées en phase 2 : `openid email profile` uniquement (aucun accès Drive).
- Inscription libre impossible. Entrent : les membres actifs, le propriétaire initial (adresse `OWNER_EMAIL`, une seule fois), les personnes ayant une invitation valide.
- Une adresse déjà liée à un compte Google ne peut pas être reprise par un autre compte Google.
- Adresse e-mail Google non vérifiée : refus.

## Invitations
Jeton aléatoire de 256 bits, stocké **haché** ; usage unique consommé de façon atomique ; expiration à 7 jours ; liée à l'adresse invitée ; annulable. Le lien n'est montré qu'une fois à l'administrateur.

## Sessions
Cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`), 7 jours. Seul le hachage du jeton est stocké. Retirer un membre révoque ses sessions.

## Permissions
- Rôles : administrateur (tout), éditeur (lecture/écriture), lecteur (lecture).
- Exceptions par ressource : `none`, `read`, `write`. **L'exception la plus proche de la ressource l'emporte.** Exemple : lecteur + `write` sur la saison 2 = peut modifier la saison 2 et ses épisodes, rien d'autre.
- Un administrateur n'est jamais restreint. Le propriétaire ne peut être ni rétrogradé ni retiré.
- Toute vérification passe par la fonction serveur `can()` ; refus par défaut (utilisateur inconnu, retiré, ressource inconnue).
- Les actions d'administration (inviter, rôles, exceptions, retrait) sont réservées aux administrateurs et journalisées.

## Protections HTTP
Contrôle de l'en-tête `Origin` sur toute requête modifiante (CSRF), en-têtes de sécurité (CSP, HSTS, nosniff, anti-framing), erreurs sans détails internes, aucun jeton dans les journaux.

## Google Drive (phase 4)
- Portée `drive.readonly` uniquement ; seules des requêtes `GET` sont émises (test automatisé). Aucun bouton de téléchargement.
- Jeton de renouvellement chiffré AES-GCM (`TOKEN_ENCRYPTION_KEY`, secret Cloudflare), jamais renvoyé au navigateur ni journalisé. Déconnexion = suppression + révocation chez Google.
- Identifiants de dossiers/fichiers validés (`[A-Za-z0-9_-]`) avant d'entrer dans une requête Drive.
- Lecteur : le HTML de Google Docs est assaini côté navigateur par **liste blanche** (balises et attributs autorisés ; scripts, styles, iframes, formulaires, SVG, gestionnaires d'événements, liens non `https`, images hors `*.googleusercontent.com` supprimés), puis affiché dans la page avec la CSP stricte (`script-src 'self'`). Vérifié sur un HTML piégé fictif.
- Listes de documents filtrées côté serveur par `readableIds()` (même règle que `can()`).

## Images (phase 6)
- Format détecté par signature (JPEG, PNG, WebP uniquement) : le type annoncé par le navigateur n'est pas cru ; SVG et HTML refusés (pas de script dans une image). Taille limitée à 1 Mo.
- Une image est servie par `/api/images/:id` avec les droits de lecture de sa fiche (sinon 404), `nosniff`, `Content-Security-Policy: default-src 'none'`, cache privé uniquement.
- Quota : avertissement à 350 Mo, refus à 450 Mo pour ne jamais approcher la limite gratuite de 500 Mo.
- Les relations et apparitions n'exposent jamais un personnage ou un épisode que l'utilisateur n'a pas le droit de lire.

## Limites connues (à traiter avant la finalisation)
- **Limitation de débit non implémentée** : l'exigence « limiter les requêtes abusives » reste à faire (prévue en phase 14 au plus tard, via des règles Cloudflare gratuites ou un compteur en base).
- Le contrôle de la signature du jeton d'identité n'est pas fait : il est obtenu directement de Google en HTTPS, ce que la documentation Google autorise, et ses revendications (émetteur, audience, expiration) sont vérifiées.
- Confirmations côté interface : l'annulation d'invitation en demande une ; le retrait d'un membre et les changements de permissions n'ont pas encore d'écran (phase 13).
- Drive : un document importé par une personne n'est suivi que tant que **sa** connexion Drive est active ; si elle se déconnecte, ses documents restent référencés mais ne se synchronisent plus (avertissement à prévoir en phase 9).
- Les notifications sont créées en base mais l'écran de notifications arrive en phase 13.
