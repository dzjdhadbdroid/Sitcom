-- Phase 4 : intégration Google Drive (lecture seule).
-- Aucun contenu de document n'est stocké : uniquement des références et des métadonnées.

-- Connexion Drive de chaque utilisateur (son propre compte Google). Le jeton de renouvellement est chiffré (AES-GCM).
CREATE TABLE drive_connections (
  user_id           TEXT PRIMARY KEY REFERENCES users (id),
  refresh_token_enc TEXT NOT NULL,
  scope             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reauth_required')),
  page_token        TEXT,                       -- jeton de la Changes API (reprise de la synchronisation)
  last_sync_at      TEXT,
  last_error        TEXT,                       -- code d'erreur compréhensible (jamais de jeton)
  connected_at      TEXT NOT NULL
);

-- Dossiers Drive choisis pour la synchronisation (par connexion).
CREATE TABLE drive_sync_folders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES drive_connections (user_id),
  folder_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  UNIQUE (user_id, folder_id)
);

-- Documents Drive connus. state = 'available' (détecté, non importé) ou 'imported' (importé manuellement).
-- Un document importé possède une ligne dans `resources` de même identifiant : les permissions s'appliquent comme au reste.
CREATE TABLE drive_documents (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users (id),   -- connexion utilisée pour le synchroniser
  drive_file_id  TEXT NOT NULL,
  title          TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  parent_ids     TEXT NOT NULL DEFAULT '[]',            -- JSON : dossiers parents connus
  modified_time  TEXT,
  web_view_link  TEXT,
  state          TEXT NOT NULL DEFAULT 'available' CHECK (state IN ('available', 'imported')),
  category       TEXT CHECK (category IN ('script', 'draft', 'notes', 'corrected', 'reference', 'other')),
  section_id     TEXT REFERENCES resources (id),
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'removed', 'trashed', 'moved_out')),
  status_detail  TEXT,
  status_at      TEXT,
  imported_by    TEXT REFERENCES users (id),
  imported_at    TEXT,
  last_seen_at   TEXT NOT NULL,
  UNIQUE (user_id, drive_file_id)
);
CREATE INDEX idx_drive_docs_state ON drive_documents (state, modified_time);
