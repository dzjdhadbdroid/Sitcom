-- Phase 2 : fondations (comptes, rôles, invitations, permissions, sessions, journal, notifications)
-- Cible : Cloudflare D1 (SQLite). Dates en ISO 8601 UTC (texte).

CREATE TABLE series (
  id         TEXT PRIMARY KEY CHECK (id = 'main'),          -- une seule série
  title      TEXT NOT NULL DEFAULT 'Ma série',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO series (id) VALUES ('main');

-- Arbre de ressources : sert de base aux permissions hiérarchiques.
-- Chaque entité de contenu (saison, épisode, personnage...) y aura une ligne portant le même id.
CREATE TABLE resources (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('series', 'section', 'season', 'episode', 'item')),
  parent_id   TEXT REFERENCES resources (id),
  archived_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_resources_parent ON resources (parent_id);

INSERT INTO resources (id, type, parent_id) VALUES ('series', 'series', NULL);
INSERT INTO resources (id, type, parent_id) VALUES
  ('section:seasons',    'section', 'series'),
  ('section:characters', 'section', 'series'),
  ('section:universe',   'section', 'series'),
  ('section:timeline',   'section', 'series'),
  ('section:ideas',      'section', 'series'),
  ('section:documents',  'section', 'series');

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT,
  picture_url TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE memberships (
  user_id     TEXT PRIMARY KEY REFERENCES users (id),
  role        TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
  is_owner    INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
  description TEXT,
  joined_at   TEXT NOT NULL,
  removed_at  TEXT
);
-- Un seul propriétaire (administrateur principal).
CREATE UNIQUE INDEX idx_single_owner ON memberships (is_owner) WHERE is_owner = 1;

CREATE TABLE invitations (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL COLLATE NOCASE,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'reader')),
  token_hash   TEXT NOT NULL UNIQUE,                         -- le jeton lui-même n'est jamais stocké
  invited_by   TEXT NOT NULL REFERENCES users (id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  cancelled_at TEXT
);
-- Une seule invitation en attente par adresse.
CREATE UNIQUE INDEX idx_invitation_pending ON invitations (email)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- Exceptions de permissions : l'élément le plus spécifique sur le chemin l'emporte.
CREATE TABLE grants (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id),
  resource_id TEXT NOT NULL REFERENCES resources (id),
  level       TEXT NOT NULL CHECK (level IN ('none', 'read', 'write')),
  created_by  TEXT NOT NULL REFERENCES users (id),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, resource_id)
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,                               -- hachage SHA-256 du jeton de cookie
  user_id    TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE activity_log (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users (id),
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  details       TEXT,                                        -- JSON, jamais de secret
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_activity_created ON activity_log (created_at);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id),
  type       TEXT NOT NULL,
  payload    TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at);
