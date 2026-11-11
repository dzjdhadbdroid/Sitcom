-- Phase 3 : fiche générale de la série (les images logo/affiche/couverture arrivent avec le stockage d'images, phase 6)
ALTER TABLE series ADD COLUMN genre TEXT;
ALTER TABLE series ADD COLUMN format TEXT;
ALTER TABLE series ADD COLUMN summary TEXT;
ALTER TABLE series ADD COLUMN planned_seasons INTEGER;
ALTER TABLE series ADD COLUMN avg_duration_min INTEGER;
ALTER TABLE series ADD COLUMN audience TEXT;
ALTER TABLE series ADD COLUMN inspirations TEXT;
ALTER TABLE series ADD COLUMN notes TEXT;
ALTER TABLE series ADD COLUMN accent_color TEXT;
ALTER TABLE series ADD COLUMN updated_at TEXT;
