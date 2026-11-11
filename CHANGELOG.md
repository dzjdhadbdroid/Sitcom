# Changelog

## 0.3.0 — Phase 3 : interface et navigation
- Menu latéral permanent (ordinateur), tiroir (tablette), barre du bas + tiroir (smartphone) ; 9 rubriques dans l'ordre du cahier des charges.
- Thèmes clair, sombre et automatique (choix conservé sur l'appareil) ; couleur principale de la série appliquée à l'interface.
- Tableau de bord de structure fixe : uniquement des données réelles (équipe, activité récente pour les administrateurs) ; les autres cartes affichent un état vide explicite tant que leurs rubriques n'existent pas.
- Paramètres : fiche de la série (modifiable, validée côté serveur), affichage, collaborateurs et invitations, compte.
- Rubriques non encore développées : page d'état honnête indiquant la phase prévue, sans bouton inactif.
- Migration `0002_series_profile.sql`, API `/api/series` et `/api/dashboard`, 7 nouveaux tests.
- Non implémenté : logo, affiche et image de couverture (phase 6, stockage d'images), réorganisation du menu (phase 3 bis ou ultérieure, à décider), export PDF.

## 0.2.0 — Phase 2 : infrastructure et authentification
- Projet, schéma D1 (`migrations/0001_init.sql`), configuration Cloudflare, CI GitHub.
- Logique de sécurité testée : chiffrement AES-GCM, permissions hiérarchiques avec exceptions, invitations (jeton haché, expiration, usage unique), connexion autorisée, sessions, protection du propriétaire.
- API Worker : OAuth Google (PKCE), sessions, invitations, membres, exceptions de permissions.
- Interface minimale : connexion Google, accueil, gestion des invitations (administrateur).
- Non implémenté : limitation de débit, écrans de gestion des membres et permissions (phase 13), e-mails d'invitation (lien copiable pour l'instant).

## 0.1.0 — Phase 1 : architecture validée
