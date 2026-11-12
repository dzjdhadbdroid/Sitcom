import { newId } from './crypto.ts';
import { nowIso, type DB } from './db.ts';
import type { Result } from './invitations.ts';
import { can } from './permissions.ts';

export const MAX_IMAGE_BYTES = 1_000_000; // 1 Mo par image : le client réduit les photos avant l'envoi
// La base gratuite D1 est limitée à 500 Mo : on avertit à 350 Mo et on refuse au-delà de 450 Mo (jamais de dépassement payant).
export const IMAGE_WARN_BYTES = 350_000_000;
export const IMAGE_REFUSE_BYTES = 450_000_000;

type Mime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Détecte le vrai format par signature (on ne fait pas confiance à l'en-tête envoyé). SVG et autres formats : refusés. */
export function sniffImage(b: Uint8Array): Mime | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function toB64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(t: string): Uint8Array {
  const s = atob(t);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function imageUsage(db: DB): Promise<{ bytes: number; warn: boolean; full: boolean }> {
  const r = await db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS n FROM images').first<{ n: number }>();
  const bytes = r?.n ?? 0;
  return { bytes, warn: bytes >= IMAGE_WARN_BYTES, full: bytes >= IMAGE_REFUSE_BYTES };
}

/** Enregistre une image rattachée à une fiche. L'appelant doit déjà avoir vérifié le droit d'écriture sur cette fiche. */
export async function storeImage(db: DB, actorId: string, resourceId: string, bytes: Uint8Array): Promise<Result<{ id: string; mime: Mime }>> {
  if (bytes.length === 0) return { ok: false, reason: 'invalid_image' };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'image_too_large' };
  const mime = sniffImage(bytes);
  if (!mime) return { ok: false, reason: 'invalid_image' };
  if ((await imageUsage(db)).full) return { ok: false, reason: 'storage_full' };
  const id = newId();
  await db
    .prepare('INSERT INTO images (id, resource_id, mime, size_bytes, data_b64, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, resourceId, mime, bytes.length, toB64(bytes), actorId, nowIso())
    .run();
  return { ok: true, id, mime };
}

/** Lecture d'une image : exige le droit de lecture sur la fiche propriétaire ; une image remplacée n'est plus servie. */
export async function getImage(db: DB, userId: string, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const row = await db.prepare('SELECT resource_id AS rid, mime, data_b64 AS data FROM images WHERE id = ? AND replaced_at IS NULL').bind(id).first<{ rid: string; mime: string; data: string }>();
  if (!row || !(await can(db, userId, 'read', row.rid))) return null;
  const arch = await db.prepare('SELECT archived_at AS a FROM resources WHERE id = ?').bind(row.rid).first<{ a: string | null }>();
  if (arch?.a) return null;
  return { mime: row.mime, bytes: fromB64(row.data) };
}
