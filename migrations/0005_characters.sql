-- Phase 6 : personnages, images, relations, apparitions manuelles.

-- Images (photos de personnages ; plus tard lieux). Stockées en base (texte base64, limite de taille appliquée côté serveur).
-- Une image remplacée n'est jamais supprimée : elle est simplement marquée « remplacée » et n'est plus servie.
CREATE TABLE images (
  id          TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources (id),   -- fiche propriétaire : détermine qui peut voir l'image
  mime        TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes  INTEGER NOT NULL,
  data_b64    TEXT NOT NULL,
  created_by  TEXT REFERENCES users (id),
  created_at  TEXT NOT NULL,
  replaced_at TEXT
);
CREATE INDEX idx_images_resource ON images (resource_id);

CREATE TABLE characters (
  id                TEXT PRIMARY KEY REFERENCES resources (id),
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  age               TEXT,                         -- texte libre (« 34 ans », « environ 50 », « adolescent »)
  physical          TEXT,
  personality       TEXT,
  history           TEXT,
  qualities         TEXT,
  flaws             TEXT,
  particularities   TEXT,
  photo_image_id    TEXT REFERENCES images (id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Relation entre deux personnages, visible depuis les deux fiches.
CREATE TABLE character_relations (
  id           TEXT PRIMARY KEY,
  character_a  TEXT NOT NULL REFERENCES characters (id),
  character_b  TEXT NOT NULL REFERENCES characters (id),
  kind         TEXT NOT NULL CHECK (kind IN ('family', 'friendship', 'couple', 'colleagues', 'rivalry', 'other')),
  description  TEXT,
  created_by   TEXT REFERENCES users (id),
  created_at   TEXT NOT NULL,
  CHECK (character_a <> character_b)
);
CREATE INDEX idx_relations_a ON character_relations (character_a);
CREATE INDEX idx_relations_b ON character_relations (character_b);

-- Apparitions renseignées MANUELLEMENT (aucune détection automatique dans les scénarios).
CREATE TABLE character_appearances (
  character_id TEXT NOT NULL REFERENCES characters (id),
  episode_id   TEXT NOT NULL REFERENCES episodes (id),
  created_by   TEXT REFERENCES users (id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (character_id, episode_id)
);
CREATE INDEX idx_appearances_episode ON character_appearances (episode_id);
