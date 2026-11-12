# Changelog

## 0.5.0 — Phase 5 : saisons et épisodes
- Saisons : création vide ou avec N emplacements générés (0 à 60), numéro automatique modifiable, titre, résumé, marquage manuel « terminée », réorganisation (↑/↓), archivage.
- Épisodes : numéro de référence (S01E01, S01SP01, HSBN01…), types (épisode, pilote, spécial, bonus, scène coupée, hors saison), statuts prédéfinis non personnalisables (Idée, En cours d'écriture, Terminé, Validé), durée, résumé, déplacement entre saisons. L'identité est un identifiant interne : changer un numéro ou réordonner ne touche à aucun document.
- Documents associés : plusieurs par épisode, un seul scénario principal, détachement (le lien seul), avertissements Drive visibles, lecteur existant réutilisé.
- Affichage liste ou cartes (choix mémorisé sur l'appareil). Tableau de bord : progression globale, avancement par saison et épisodes par statut, calculés sur les données réelles et filtrés par permissions.
- Archivage uniquement (aucune suppression définitive) ; l'écran des archives et la restauration arrivent en phase 12.
- Migration `0004_seasons_episodes.sql`, 15 nouveaux tests (76 au total), contrôle visuel 76/76.
- Non implémenté : réorganisation par glisser-déposer (boutons ↑/↓ pour l'instant), personnages présents et événements liés (phases 6 et 8), statistiques détaillées.

## 0.4.0 — Phase 4 : Google Drive et Google Docs (lecture seule)
- Connexion Drive séparée (portée `drive.readonly`, jeton chiffré), déconnexion avec révocation, choix des dossiers à surveiller.
- Synchronisation par l'API Changes (Cron toutes les 15 min, à l'ouverture, bouton manuel), reprise après interruption, nouvelles tentatives, erreurs sans perte de données.
- Import **manuel** avec catégorie et rubrique ; classement modifiable ; avertissements pour documents supprimés, en corbeille, déplacés ou inaccessibles (références conservées).
- Lecteur de documents (HTML assaini, taille/police, recherche, « Ouvrir dans Google Docs », aucun téléchargement) ; carte « Derniers documents modifiés » réelle, filtrée par permissions.
- Correctif : `readableIds` ne renvoie plus les ressources inexistantes pour un administrateur.
- Migration `0003_drive.sql`, 26 nouveaux tests (61 au total), contrôle visuel 63/63.
- Non validé : comportement du vrai Google (voir `docs/GOOGLE_INTEGRATION.md`), build/Worker/CI jamais exécutés dans cet environnement. Non implémenté : écran de notifications (phase 13), limitation de débit.

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
