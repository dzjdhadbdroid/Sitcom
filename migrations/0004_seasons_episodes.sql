-- Phase 5 : saisons, épisodes et documents associés.
-- Chaque saison/épisode a une ligne dans `resources` de même identifiant (permissions hiérarchiques).
-- L'identité d'un épisode est son identifiant interne : le numéro affiché est modifiable sans rien casser.

CREATE TABLE seasons (
  id          TEXT PRIMARY KEY REFERENCES resources (id),
  number      INTEGER,                       -- numéro affiché (S01) ; modifiable, non unique
  title       TEXT NOT NULL DEFAULT '',
  summary     TEXT,
  position    INTEGER NOT NULL,              -- ordre d'affichage (réorganisable)
  finished_at TEXT,                          -- marquage manuel « terminée »
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE episodes (
  id           TEXT PRIMARY KEY REFERENCES resources (id),
  season_id    TEXT REFERENCES seasons (id),   -- NULL = hors saison
  kind         TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'pilot', 'special', 'bonus', 'cut_scene')),
  number       INTEGER,
  title        TEXT NOT NULL DEFAULT '',
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'writing', 'done', 'validated')),
  duration_min INTEGER,
  position     INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_episodes_season ON episodes (season_id, position);

-- Documents Google Docs rattachés à un épisode (plusieurs possibles, au plus un « scénario principal »).
CREATE TABLE episode_documents (
  episode_id  TEXT NOT NULL REFERENCES episodes (id),
  document_id TEXT NOT NULL REFERENCES drive_documents (id),
  is_main     INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
  linked_by   TEXT REFERENCES users (id),
  linked_at   TEXT NOT NULL,
  PRIMARY KEY (episode_id, document_id)
);
CREATE UNIQUE INDEX idx_episode_main_doc ON episode_documents (episode_id) WHERE is_main = 1;
CREATE INDEX idx_episode_docs_doc ON episode_documents (document_id);
