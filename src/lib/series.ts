import { logStmt } from './audit.ts';
import { nowIso, type DB } from './db.ts';
import type { Result } from './invitations.ts';
import { can } from './permissions.ts';

export interface SeriesProfile {
  title: string;
  genre: string | null;
  format: string | null;
  summary: string | null;
  plannedSeasons: number | null;
  avgDurationMin: number | null;
  audience: string | null;
  inspirations: string | null;
  notes: string | null;
  accentColor: string | null;
  updatedAt: string | null;
}

export type SeriesPatch = Partial<SeriesProfile>;

const TEXT_COLUMNS = {
  title: 'title',
  genre: 'genre',
  format: 'format',
  summary: 'summary',
  audience: 'audience',
  inspirations: 'inspirations',
  notes: 'notes',
} as const;

const SHORT = 200;
const LONG = 5000;

export async function getSeries(db: DB, userId: string): Promise<SeriesProfile | null> {
  if (!(await can(db, userId, 'read', 'series'))) return null;
  const r = await db
    .prepare(
      `SELECT title, genre, format, summary, planned_seasons AS plannedSeasons, avg_duration_min AS avgDurationMin,
              audience, inspirations, notes, accent_color AS accentColor, updated_at AS updatedAt
       FROM series WHERE id = 'main'`,
    )
    .first<SeriesProfile>();
  return r;
}

const intOrNull = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined; // undefined = invalide
};

/** Met à jour la fiche. Seuls les champs connus sont pris en compte ; tout est validé côté serveur. */
export async function updateSeries(db: DB, actorId: string, patch: SeriesPatch): Promise<Result<{ changed: string[] }>> {
  if (!(await can(db, actorId, 'write', 'series'))) return { ok: false, reason: 'forbidden' };

  const sets: string[] = [];
  const values: unknown[] = [];
  const changed: string[] = [];

  for (const [key, column] of Object.entries(TEXT_COLUMNS)) {
    if (!(key in patch)) continue;
    const raw = (patch as Record<string, unknown>)[key];
    if (raw !== null && typeof raw !== 'string') return { ok: false, reason: `invalid_${key}` };
    const value = raw === null ? null : raw.trim();
    if (key === 'title') {
      if (!value || value.length > SHORT) return { ok: false, reason: 'invalid_title' };
    } else if (value !== null && value.length > (key === 'genre' || key === 'format' || key === 'audience' ? SHORT : LONG)) {
      return { ok: false, reason: `invalid_${key}` };
    }
    sets.push(`${column} = ?`);
    values.push(value === '' ? null : value);
    changed.push(key);
  }

  if ('plannedSeasons' in patch) {
    const n = intOrNull(patch.plannedSeasons, 1, 99);
    if (n === undefined) return { ok: false, reason: 'invalid_plannedSeasons' };
    sets.push('planned_seasons = ?'); values.push(n); changed.push('plannedSeasons');
  }
  if ('avgDurationMin' in patch) {
    const n = intOrNull(patch.avgDurationMin, 1, 600);
    if (n === undefined) return { ok: false, reason: 'invalid_avgDurationMin' };
    sets.push('avg_duration_min = ?'); values.push(n); changed.push('avgDurationMin');
  }
  if ('accentColor' in patch) {
    const c = patch.accentColor;
    if (c !== null && !(typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) return { ok: false, reason: 'invalid_accentColor' };
    sets.push('accent_color = ?'); values.push(c ?? null); changed.push('accentColor');
  }

  if (changed.length === 0) return { ok: false, reason: 'nothing_to_update' };

  sets.push('updated_at = ?');
  values.push(nowIso());
  await db.batch([
    db.prepare(`UPDATE series SET ${sets.join(', ')} WHERE id = 'main'`).bind(...values),
    // Le journal conserve les noms des champs modifiés, jamais leur contenu.
    logStmt(db, { actor: actorId, action: 'series.updated', resourceType: 'series', resourceId: 'main', details: { fields: changed } }),
  ]);
  return { ok: true, changed };
}
