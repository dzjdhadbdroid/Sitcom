// Faux serveur Google pour les tests : AUCUN appel réseau réel. Les résultats de ces tests prouvent la logique de
// l'application face à des réponses Google simulées, pas le comportement du vrai Google (à valider avec un vrai compte).
import type { FetchLike } from '../../src/lib/drive.ts';

export interface FakeFile {
  id: string; name: string; mimeType: string; parents: string[]; modifiedTime: string; trashed?: boolean;
  html?: string; accessible?: boolean; // accessible=false => 403 pour ce compte
}

export class FakeGoogle {
  files = new Map<string, FakeFile>();
  removedIds = new Set<string>();
  changeLog: { fileId: string; removed?: boolean }[] = [];
  requests: { method: string; url: string }[] = [];
  refreshStatus = 200; // 400 + invalid_grant pour simuler une révocation
  refreshError = 'invalid_grant';
  failNext: { status: number; times: number; reason?: string } | null = null;
  accessToken = 'ACCESS-TOKEN-TEST';

  add(f: Partial<FakeFile> & { id: string }) {
    const full: FakeFile = { name: f.id, mimeType: 'application/vnd.google-apps.document', parents: ['root'], modifiedTime: '2026-01-01T00:00:00.000Z', accessible: true, ...f };
    this.files.set(full.id, full);
    this.changeLog.push({ fileId: full.id });
    return full;
  }
  touch(id: string, patch: Partial<FakeFile>) {
    Object.assign(this.files.get(id)!, patch);
    this.changeLog.push({ fileId: id });
  }
  remove(id: string) {
    this.files.delete(id);
    this.changeLog.push({ fileId: id, removed: true });
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
  private pub(f: FakeFile) {
    return { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime, trashed: !!f.trashed, webViewLink: `https://docs.google.com/document/d/${f.id}/edit` };
  }

  fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    this.requests.push({ method, url });
    const u = new URL(url);

    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/token') {
      if (this.refreshStatus !== 200) return this.json({ error: this.refreshError }, this.refreshStatus);
      return this.json({ access_token: this.accessToken, expires_in: 3600 });
    }
    if (u.hostname === 'oauth2.googleapis.com' && u.pathname === '/revoke') return this.json({});

    if (u.hostname !== 'www.googleapis.com') return new Response('hors périmètre', { status: 500 });
    if (init?.headers && (init.headers as Record<string, string>).Authorization !== `Bearer ${this.accessToken}`) return this.json({ error: { status: 'UNAUTHENTICATED' } }, 401);

    if (this.failNext && this.failNext.times > 0) {
      this.failNext.times--;
      return this.json({ error: { errors: [{ reason: this.failNext.reason ?? 'backendError' }] } }, this.failNext.status);
    }

    const p = u.pathname.replace('/drive/v3', '');
    const q = u.searchParams;

    if (p === '/changes/startPageToken') return this.json({ startPageToken: String(this.changeLog.length) });
    if (p === '/changes') {
      const from = Number(q.get('pageToken'));
      const size = Number(q.get('pageSize') ?? 100);
      const slice = this.changeLog.slice(from, from + size);
      const next = from + slice.length;
      const changes = slice.map((c) => {
        const f = this.files.get(c.fileId);
        return c.removed || !f || f.accessible === false ? { fileId: c.fileId, removed: true } : { fileId: c.fileId, file: this.pub(f) };
      });
      return next < this.changeLog.length ? this.json({ changes, nextPageToken: String(next) }) : this.json({ changes, newStartPageToken: String(next) });
    }
    if (p === '/files') {
      const query = q.get('q') ?? '';
      const parent = /'([^']+)' in parents/.exec(query)?.[1];
      const wantFolders = query.includes("mimeType = 'application/vnd.google-apps.folder'");
      const list = [...this.files.values()].filter((f) => !f.trashed && parent && f.parents.includes(parent) && (f.mimeType === 'application/vnd.google-apps.folder') === wantFolders);
      return this.json({ files: list.map((f) => this.pub(f)) });
    }
    const m = /^\/files\/([^/]+)(\/export)?$/.exec(p);
    if (m) {
      const f = this.files.get(m[1]);
      if (!f) return this.json({ error: { status: 'NOT_FOUND' } }, 404);
      if (f.accessible === false) return this.json({ error: { errors: [{ reason: 'forbidden' }] } }, 403);
      if (m[2]) return new Response(f.html ?? '<p>vide</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      return this.json(this.pub(f));
    }
    return this.json({ error: { status: 'NOT_FOUND' } }, 404);
  };
}
