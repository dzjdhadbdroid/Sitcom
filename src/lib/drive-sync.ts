import { newId } from './crypto.ts';
import { logStmt, notifyStmt } from './audit.ts';
import { nowIso, type DB, type Stmt } from './db.ts';
import { clientFor, markReauthRequired, type DriveSecrets } from './drive-connection.ts';
import { DOC_MIME, DriveClient, DriveError, FOLDER_MIME, type DriveChange, type DriveFile, type FetchLike } from './drive.ts';
import type { Result } from './invitations.ts';
import { can, readableIds } from './permissions.ts';

export const CATEGORIES = ['script', 'draft', 'notes', 'corrected', 'reference', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const IMPORT_SECTIONS = ['section:seasons', 'section:characters', 'section:universe', 'section:timeline', 'section:ideas', 'section:documents'];

const json = (v: unknown) => JSON.stringify(v);

// ---------- Dossiers synchronisés ----------

export interface SyncFolder { id: string; folderId: string; name: string; addedAt: string }

export async function listSyncFolders(db: DB, userId: string): Promise<SyncFolder[]> {
  const { results } = await db
    .prepare('SELECT id, folder_id AS folderId, name, added_at AS addedAt FROM drive_sync_folders WHERE user_id = ? ORDER BY name')
    .bind(userId)
    .all<SyncFolder>();
  return results;
}

/** Ajoute un dossier à synchroniser. Le dossier est vérifié auprès de Drive (il doit exister et être un dossier). */
export async function addSyncFolder(db: DB, actorId: string, drive: DriveClient, folderId: string): Promise<Result<{ name: string }>> {
  if (!(await can(db, actorId, 'write', 'section:documents'))) return { ok: false, reason: 'forbidden' };
  let file: DriveFile;
  try {
    file = await drive.getFile(folderId);
  } catch (e) {
    return { ok: false, reason: e instanceof DriveError ? e.kind : 'unknown' };
  }
  if (file.mimeType !== FOLDER_MIME) return { ok: false, reason: 'not_a_folder' };
  await db.batch([
    db
      .prepare('INSERT INTO drive_sync_folders (id, user_id, folder_id, name, added_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, folder_id) DO UPDATE SET name = excluded.name')
      .bind(newId(), actorId, file.id, file.name, nowIso()),
    logStmt(db, { actor: actorId, action: 'drive.folder_added', resourceType: 'drive_folder', resourceId: file.id, details: { name: file.name } }),
  ]);
  return { ok: true, name: file.name };
}

/** Retire un dossier de la synchronisation. Les documents déjà importés et leur classement sont conservés. */
export async function removeSyncFolder(db: DB, actorId: string, folderId: string): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', 'section:documents'))) return { ok: false, reason: 'forbidden' };
  const r = await db.prepare('DELETE FROM drive_sync_folders WHERE user_id = ? AND folder_id = ?').bind(actorId, folderId).run();
  if (r.meta.changes === 0) return { ok: false, reason: 'not_found' };
  await logStmt(db, { actor: actorId, action: 'drive.folder_removed', resourceType: 'drive_folder', resourceId: folderId }).run();
  return { ok: true };
}

// ---------- Documents disponibles et import manuel ----------

export interface DocRow {
  id: string; driveFileId: string; title: string; mimeType: string; modifiedTime: string | null; webViewLink: string | null;
  state: 'available' | 'imported'; category: Category | null; sectionId: string | null; status: string; statusDetail: string | null;
  viewable: boolean;
}

const DOC_COLS = `id, drive_file_id AS driveFileId, title, mime_type AS mimeType, modified_time AS modifiedTime, web_view_link AS webViewLink,
  state, category, section_id AS sectionId, status, status_detail AS statusDetail`;
const withViewable = (r: Omit<DocRow, 'viewable'>): DocRow => ({ ...r, viewable: r.mimeType === DOC_MIME });

function upsertAvailable(db: DB, userId: string, f: DriveFile, now: string): Stmt {
  return db
    .prepare(
      `INSERT INTO drive_documents (id, user_id, drive_file_id, title, mime_type, parent_ids, modified_time, web_view_link, state, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
       ON CONFLICT (user_id, drive_file_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, title = excluded.title,
         modified_time = excluded.modified_time, parent_ids = excluded.parent_ids, web_view_link = excluded.web_view_link
       WHERE drive_documents.state = 'available'`,
    )
    .bind(newId(), userId, f.id, f.name, f.mimeType, json(f.parents ?? []), f.modifiedTime ?? null, f.webViewLink ?? null, now);
}

/** Dossiers Drive navigables (une page de sous-dossiers). Aucun import, aucune écriture. */
export async function browseFolders(drive: DriveClient, parentId: string) {
  const r = await drive.listFolders(parentId);
  return r.files.map((f) => ({ id: f.id, name: f.name }));
}

/** Liste les documents des dossiers synchronisés (lecture Drive) et mémorise ceux qui sont nouveaux comme « disponibles ». */
export async function refreshAvailable(db: DB, userId: string, drive: DriveClient, maxCalls = 12): Promise<void> {
  const now = nowIso();
  for (const folder of await listSyncFolders(db, userId)) {
    let token: string | undefined;
    do {
      if (drive.calls >= maxCalls) return;
      const page = await drive.listFilesInFolder(folder.folderId, token);
      if (page.files.length) await db.batch(page.files.map((f) => upsertAvailable(db, userId, f, now)));
      token = page.nextPageToken;
    } while (token);
  }
}

export async function listAvailable(db: DB, userId: string): Promise<DocRow[]> {
  const { results } = await db
    .prepare(`SELECT ${DOC_COLS} FROM drive_documents WHERE user_id = ? AND state = 'available' ORDER BY modified_time DESC`)
    .bind(userId)
    .all<Omit<DocRow, 'viewable'>>();
  return results.map(withViewable);
}

export interface ImportItem { id: string; category: string; sectionId: string }

/**
 * Import MANUEL : seuls les documents que l'utilisateur sélectionne sont intégrés, avec la catégorie et la rubrique choisies.
 * Aucun classement automatique. Chaque document importé devient une ressource soumise aux permissions.
 */
export async function importDocuments(db: DB, actorId: string, items: ImportItem[]): Promise<Result<{ imported: number }>> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) return { ok: false, reason: 'invalid_selection' };
  for (const it of items) {
    if (!CATEGORIES.includes(it.category as Category)) return { ok: false, reason: 'invalid_category' };
    if (!IMPORT_SECTIONS.includes(it.sectionId)) return { ok: false, reason: 'invalid_section' };
    if (!(await can(db, actorId, 'write', it.sectionId))) return { ok: false, reason: 'forbidden' };
  }
  const stmts: Stmt[] = [];
  const now = nowIso();
  let count = 0;
  for (const it of items) {
    const row = await db
      .prepare("SELECT id, title FROM drive_documents WHERE id = ? AND user_id = ? AND state = 'available'")
      .bind(it.id, actorId)
      .first<{ id: string; title: string }>();
    if (!row) continue; // inconnu, déjà importé ou appartenant à un autre compte : ignoré
    count++;
    stmts.push(
      db.prepare("INSERT INTO resources (id, type, parent_id) VALUES (?, 'item', ?)").bind(row.id, it.sectionId),
      db
        .prepare("UPDATE drive_documents SET state = 'imported', category = ?, section_id = ?, imported_by = ?, imported_at = ? WHERE id = ?")
        .bind(it.category, it.sectionId, actorId, now, row.id),
      logStmt(db, { actor: actorId, action: 'document.imported', resourceType: 'document', resourceId: row.id, details: { category: it.category, section: it.sectionId } }),
    );
  }
  if (count === 0) return { ok: false, reason: 'nothing_to_import' };
  await db.batch(stmts);
  return { ok: true, imported: count };
}

/** Change la catégorie ou la rubrique d'un document importé (classement manuel). Ne touche jamais au fichier Drive. */
export async function reclassify(db: DB, actorId: string, docId: string, patch: { category?: string; sectionId?: string }): Promise<Result<object>> {
  if (!(await can(db, actorId, 'write', docId))) return { ok: false, reason: 'forbidden' };
  const doc = await db.prepare("SELECT category, section_id FROM drive_documents WHERE id = ? AND state = 'imported'").bind(docId).first<{ category: string; section_id: string }>();
  if (!doc) return { ok: false, reason: 'not_found' };
  const category = patch.category ?? doc.category;
  const sectionId = patch.sectionId ?? doc.section_id;
  if (!CATEGORIES.includes(category as Category)) return { ok: false, reason: 'invalid_category' };
  if (!IMPORT_SECTIONS.includes(sectionId)) return { ok: false, reason: 'invalid_section' };
  if (sectionId !== doc.section_id && !(await can(db, actorId, 'write', sectionId))) return { ok: false, reason: 'forbidden' };
  await db.batch([
    db.prepare('UPDATE drive_documents SET category = ?, section_id = ? WHERE id = ?').bind(category, sectionId, docId),
    db.prepare('UPDATE resources SET parent_id = ? WHERE id = ?').bind(sectionId, docId),
    logStmt(db, { actor: actorId, action: 'document.reclassified', resourceType: 'document', resourceId: docId, details: { category, section: sectionId } }),
  ]);
  return { ok: true };
}

/** Documents importés que l'utilisateur a le droit de voir (filtre de permissions appliqué côté serveur). */
export async function listImported(db: DB, userId: string, limit = 500): Promise<DocRow[]> {
  const { results } = await db
    .prepare(`SELECT ${DOC_COLS} FROM drive_documents WHERE state = 'imported' ORDER BY modified_time DESC LIMIT ?`)
    .bind(limit)
    .all<Omit<DocRow, 'viewable'>>();
  const ok = await readableIds(db, userId, results.map((r) => r.id));
  return results.filter((r) => ok.has(r.id)).map(withViewable);
}

// ---------- Synchronisation ----------

export interface SyncOptions {
  maxCalls?: number; // budget de requêtes Drive par exécution (limite de sous-requêtes des Workers)
  maxAttempts?: number; // tentatives pour les erreurs temporaires
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncResult {
  ok: boolean;
  complete: boolean;
  error?: string;
  baseline?: boolean;
  changesSeen: number;
  newDocuments: number;
  modified: number;
  statusChanged: number;
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof DriveError && e.retryable) || i >= attempts) throw e;
      await sleep(400 * i);
    }
  }
}

interface Tracked { id: string; state: string; title: string; modified_time: string | null; parent_ids: string; status: string; imported_by: string | null }

/** Prévient les membres qui peuvent lire le document, sans doublon tant que la notification précédente n'est pas lue. */
async function notifyReaders(db: DB, docId: string, type: string, payload: Record<string, unknown>): Promise<void> {
  const { results: members } = await db.prepare('SELECT user_id AS id FROM memberships WHERE removed_at IS NULL').all<{ id: string }>();
  const stmts: Stmt[] = [];
  for (const m of members) {
    if (!(await can(db, m.id, 'read', docId))) continue;
    const dup = await db
      .prepare("SELECT 1 AS x FROM notifications WHERE user_id = ? AND type = ? AND read_at IS NULL AND json_extract(payload, '$.documentId') = ?")
      .bind(m.id, type, docId)
      .first();
    if (!dup) stmts.push(notifyStmt(db, m.id, type, { documentId: docId, ...payload }));
  }
  if (stmts.length) await db.batch(stmts);
}

async function setStatus(db: DB, doc: Tracked, status: 'ok' | 'removed' | 'trashed' | 'moved_out', detail: string | null): Promise<boolean> {
  if (doc.status === status) return false;
  await db.batch([
    db.prepare('UPDATE drive_documents SET status = ?, status_detail = ?, status_at = ? WHERE id = ?').bind(status, detail, nowIso(), doc.id),
    logStmt(db, { actor: null, action: status === 'ok' ? 'drive.document_restored' : 'drive.document_unavailable', resourceType: 'document', resourceId: doc.id, details: { status } }),
  ]);
  if (status !== 'ok' && doc.state === 'imported') await notifyReaders(db, doc.id, 'document.inaccessible', { title: doc.title, reason: status });
  return true;
}

async function applyChange(db: DB, userId: string, change: DriveChange, folders: Set<string>, tally: SyncResult): Promise<void> {
  const doc = await db
    .prepare('SELECT id, state, title, modified_time, parent_ids, status, imported_by FROM drive_documents WHERE user_id = ? AND drive_file_id = ?')
    .bind(userId, change.fileId)
    .first<Tracked>();
  const f = change.file;
  const now = nowIso();

  if (!doc) {
    // Nouveau document dans un dossier synchronisé : détecté comme « disponible », jamais importé automatiquement.
    if (f && !change.removed && !f.trashed && f.mimeType !== FOLDER_MIME && (f.parents ?? []).some((p) => folders.has(p))) {
      await upsertAvailable(db, userId, f, now).run();
      tally.newDocuments++;
    }
    return;
  }

  // Suppression, ou accès retiré pour ce compte. On CONSERVE la référence, le titre et le classement.
  if (change.removed || !f) {
    if (await setStatus(db, doc, 'removed', 'Supprimé de Google Drive ou accès retiré pour ce compte.')) tally.statusChanged++;
    return;
  }
  if (f.trashed) {
    if (await setStatus(db, doc, 'trashed', 'Placé dans la corbeille de Google Drive.')) tally.statusChanged++;
    return;
  }

  const oldParents: string[] = JSON.parse(doc.parent_ids);
  const newParents = f.parents ?? [];
  const moved = oldParents.length !== newParents.length || oldParents.some((p) => !newParents.includes(p));
  const modified = !!f.modifiedTime && f.modifiedTime !== doc.modified_time;

  const sets: string[] = ['last_seen_at = ?', 'web_view_link = ?'];
  const vals: unknown[] = [now, f.webViewLink ?? null];
  if (moved) { sets.push('parent_ids = ?'); vals.push(json(newParents)); }
  if (modified) { sets.push('modified_time = ?'); vals.push(f.modifiedTime); }
  if (f.name !== doc.title) { sets.push('title = ?'); vals.push(f.name); }
  await db.prepare(`UPDATE drive_documents SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, doc.id).run();

  if (moved && !newParents.some((p) => folders.has(p))) {
    if (await setStatus(db, doc, 'moved_out', 'Déplacé hors des dossiers synchronisés.')) tally.statusChanged++;
  } else if (await setStatus(db, doc, 'ok', null)) {
    tally.statusChanged++; // redevenu disponible
  }

  if (modified && doc.state === 'imported') {
    tally.modified++;
    await notifyReaders(db, doc.id, 'document.modified', { title: f.name });
  }
}

/**
 * Synchronise la connexion d'un utilisateur via la Changes API de Drive (lecture seule, reprenable).
 * Une erreur n'efface JAMAIS de données : elle est enregistrée, signalée, puis la synchronisation reprendra.
 */
export async function syncConnection(db: DB, userId: string, secrets: DriveSecrets, fetcher?: FetchLike, opts: SyncOptions = {}): Promise<SyncResult> {
  const maxCalls = opts.maxCalls ?? 15;
  const attempts = opts.maxAttempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tally: SyncResult = { ok: true, complete: false, changesSeen: 0, newDocuments: 0, modified: 0, statusChanged: 0 };

  const fail = async (e: unknown): Promise<SyncResult> => {
    const kind = e instanceof DriveError ? e.kind : 'unknown';
    if (kind === 'auth_revoked') await markReauthRequired(db, userId);
    const prev = await db.prepare('SELECT last_error FROM drive_connections WHERE user_id = ?').bind(userId).first<{ last_error: string | null }>();
    if (prev && prev.last_error !== kind) {
      await db.batch([
        db.prepare('UPDATE drive_connections SET last_error = ? WHERE user_id = ?').bind(kind, userId),
        ...(kind === 'auth_revoked' ? [] : [notifyStmt(db, userId, 'sync.error', { error: kind })]),
        logStmt(db, { actor: null, action: 'drive.sync_error', resourceType: 'user', resourceId: userId, details: { error: kind } }),
      ]);
    }
    return { ...tally, ok: false, error: kind };
  };

  try {
    const conn = await db.prepare('SELECT page_token FROM drive_connections WHERE user_id = ?').bind(userId).first<{ page_token: string | null }>();
    if (!conn) return { ...tally, ok: false, error: 'not_connected' };
    const drive = await clientFor(db, userId, secrets, fetcher);

    let token = conn.page_token;
    if (!token) {
      // Première synchronisation : on note le point de départ. Les documents sont listés à la demande (import manuel).
      token = await withRetry(() => drive.getStartPageToken(), attempts, sleep);
      await db.prepare('UPDATE drive_connections SET page_token = ?, last_sync_at = ?, last_error = NULL WHERE user_id = ?').bind(token, nowIso(), userId).run();
      return { ...tally, complete: true, baseline: true };
    }

    const folders = new Set((await listSyncFolders(db, userId)).map((f) => f.folderId));
    while (drive.calls < maxCalls) {
      const page = await withRetry(() => drive.listChanges(token!), attempts, sleep);
      for (const change of page.changes) {
        tally.changesSeen++;
        await applyChange(db, userId, change, folders, tally);
      }
      token = page.nextPageToken ?? page.newStartPageToken ?? token;
      // Le point de reprise n'avance qu'une fois la page entièrement traitée.
      await db.prepare('UPDATE drive_connections SET page_token = ? WHERE user_id = ?').bind(token, userId).run();
      if (!page.nextPageToken) { tally.complete = true; break; }
    }
    await db.batch([
      db.prepare('UPDATE drive_connections SET last_sync_at = ?, last_error = NULL WHERE user_id = ?').bind(nowIso(), userId),
      logStmt(db, { actor: null, action: 'drive.synced', resourceType: 'user', resourceId: userId, details: { changes: tally.changesSeen, new: tally.newDocuments, modified: tally.modified } }),
    ]);
    return tally;
  } catch (e) {
    return fail(e);
  }
}

/** Synchronise si la dernière synchronisation date de plus de `minAgeMs` (ouverture de l'application). */
export async function syncIfStale(db: DB, userId: string, secrets: DriveSecrets, minAgeMs: number, fetcher?: FetchLike, opts?: SyncOptions): Promise<SyncResult | null> {
  const c = await db.prepare("SELECT last_sync_at, status FROM drive_connections WHERE user_id = ?").bind(userId).first<{ last_sync_at: string | null; status: string }>();
  if (!c || c.status !== 'active') return null;
  if (c.last_sync_at && Date.now() - Date.parse(c.last_sync_at) < minAgeMs) return null;
  return syncConnection(db, userId, secrets, fetcher, opts);
}

/** Tâche planifiée : synchronise les connexions actives, les moins récemment synchronisées d'abord. */
export async function syncAll(db: DB, secrets: DriveSecrets, fetcher?: FetchLike, opts: SyncOptions & { maxConnections?: number } = {}): Promise<number> {
  const { results } = await db
    .prepare("SELECT user_id AS id FROM drive_connections WHERE status = 'active' ORDER BY COALESCE(last_sync_at, '') ASC LIMIT ?")
    .bind(opts.maxConnections ?? 3)
    .all<{ id: string }>();
  for (const c of results) await syncConnection(db, c.id, secrets, fetcher, { maxCalls: 12, ...opts });
  return results.length;
}

// ---------- Lecture d'un document ----------

export type ReadResult = { ok: true; html: string; title: string; openUrl: string | null } | { ok: false; reason: string };

/**
 * Lit un Google Doc avec le compte Google DE L'UTILISATEUR (jamais celui d'un autre) : les droits Drive sont respectés.
 * Sans accès, le document reste visible dans l'application mais son contenu est indiqué comme inaccessible.
 */
export async function readDocument(db: DB, userId: string, docId: string, secrets: DriveSecrets, fetcher?: FetchLike): Promise<ReadResult> {
  if (!(await can(db, userId, 'read', docId))) return { ok: false, reason: 'forbidden' };
  const doc = await db
    .prepare("SELECT drive_file_id, title, mime_type, web_view_link FROM drive_documents WHERE id = ? AND state = 'imported'")
    .bind(docId)
    .first<{ drive_file_id: string; title: string; mime_type: string; web_view_link: string | null }>();
  if (!doc) return { ok: false, reason: 'not_found' };
  if (doc.mime_type !== DOC_MIME) return { ok: false, reason: 'not_viewable' };
  try {
    const drive = await clientFor(db, userId, secrets, fetcher);
    const html = await withRetry(() => drive.exportHtml(doc.drive_file_id), 2, (ms) => new Promise((r) => setTimeout(r, ms)));
    if (html.length > 8_000_000) return { ok: false, reason: 'too_large' };
    return { ok: true, html, title: doc.title, openUrl: doc.web_view_link };
  } catch (e) {
    if (!(e instanceof DriveError)) return { ok: false, reason: 'unknown' };
    if (e.kind === 'auth_revoked') {
      const c = await db.prepare('SELECT 1 AS x FROM drive_connections WHERE user_id = ?').bind(userId).first();
      return { ok: false, reason: c ? 'reauth_required' : 'not_connected' };
    }
    return { ok: false, reason: e.kind === 'forbidden' || e.kind === 'not_found' ? 'inaccessible' : e.kind };
  }
}
