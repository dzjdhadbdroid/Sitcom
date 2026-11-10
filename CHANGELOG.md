# Changelog

## 0.2.0 — Phase 2 : infrastructure et authentification
- Projet, schéma D1 (`migrations/0001_init.sql`), configuration Cloudflare, CI GitHub.
- Logique de sécurité testée : chiffrement AES-GCM, permissions hiérarchiques avec exceptions, invitations (jeton haché, expiration, usage unique), connexion autorisée, sessions, protection du propriétaire.
- API Worker : OAuth Google (PKCE), sessions, invitations, membres, exceptions de permissions.
- Interface minimale : connexion Google, accueil, gestion des invitations (administrateur).
- Non implémenté : limitation de débit, écrans de gestion des membres et permissions (phase 13), e-mails d'invitation (lien copiable pour l'instant).

## 0.1.0 — Phase 1 : architecture validée
