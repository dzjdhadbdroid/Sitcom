// Client Google Drive. LECTURE SEULE : seules des requêtes GET sont émises vers l'API Drive.
// `fetch` est injectable pour pouvoir tester sans Google (voir tests/helpers/fake-google.ts).

export type DriveErrorKind =
  | 'auth_revoked' // autorisation révoquée ou expirée : l'utilisateur doit se reconnecter
  | 'forbidden' // pas le droit d'accéder à ce fichier avec ce compte
  | 'not_found' // supprimé, ou plus visible par ce compte
  | 'rate_limited' // quota Google : réessayer plus tard
  | 'temporary' // erreur réseau ou serveur Google : réessayer
  | 'too_large' // export trop volumineux
  | 'unknown';

export class DriveError extends Error {
  kind: DriveErrorKind;
  constructor(kind: DriveErrorKind, message = kind) {
    super(message);
    this.kind = kind;
  }
  get retryable(): boolean {
    return this.kind === 'temporary' || this.kind === 'rate_limited';
  }
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DOC_MIME = 'application/vnd.google-apps.document';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  trashed?: boolean;
  webViewLink?: string;
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}

const API = 'https://www.googleapis.com/drive/v3';
const FILE_FIELDS = 'id,name,mimeType,parents,modifiedTime,trashed,webViewLink';
const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** Un identifiant Drive ne contient que des caractères sûrs : on refuse tout le reste (injection dans la requête `q`). */
export function assertDriveId(id: string): string {
  if (id !== 'root' && !ID_RE.test(id)) throw new DriveError('unknown', 'identifiant Drive invalide');
  return id;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class DriveClient {
  private accessToken: string;
  private fetcher: FetchLike;
  calls = 0;

  constructor(accessToken: string, fetcher: FetchLike = fetch) {
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  private async get(path: string, params: Record<string, string>): Promise<Response> {
    this.calls++;
    const url = `${API}${path}?${new URLSearchParams(params).toString()}`;
    let res: Response;
    try {
      // method GET explicite : cette classe ne doit jamais modifier Drive.
      res = await this.fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${this.accessToken}` } });
    } catch {
      throw new DriveError('temporary', 'réseau');
    }
    if (res.ok) return res;
    const reason = await res.json().then((b: { error?: { errors?: { reason?: string }[]; status?: string } }) => b?.error?.errors?.[0]?.reason ?? b?.error?.status ?? '', () => '');
    if (res.status === 401) throw new DriveError('auth_revoked');
    if (res.status === 404) throw new DriveError('not_found');
    if (res.status === 429 || (res.status === 403 && /rateLimit|quota|userRateLimit/i.test(reason))) throw new DriveError('rate_limited');
    if (res.status === 403) {
      if (/exportSizeLimitExceeded/i.test(reason)) throw new DriveError('too_large');
      throw new DriveError('forbidden');
    }
    if (res.status >= 500) throw new DriveError('temporary', `HTTP ${res.status}`);
    throw new DriveError('unknown', `HTTP ${res.status}`);
  }

  private common = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };

  async listFolders(parentId: string, pageToken?: string) {
    const q = `'${assertDriveId(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const res = await this.get('/files', { ...this.common, q, orderBy: 'name', pageSize: '100', fields: `nextPageToken,files(${FILE_FIELDS})`, ...(pageToken ? { pageToken } : {}) });
    return (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
  }

  async listFilesInFolder(folderId: string, pageToken?: string) {
    const q = `'${assertDriveId(folderId)}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`;
    const res = await this.get('/files', { ...this.common, q, orderBy: 'modifiedTime desc', pageSize: '100', fields: `nextPageToken,files(${FILE_FIELDS})`, ...(pageToken ? { pageToken } : {}) });
    return (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const res = await this.get(`/files/${assertDriveId(fileId)}`, { ...this.common, fields: FILE_FIELDS });
    return (await res.json()) as DriveFile;
  }

  async getStartPageToken(): Promise<string> {
    const res = await this.get('/changes/startPageToken', { supportsAllDrives: 'true' });
    return ((await res.json()) as { startPageToken: string }).startPageToken;
  }

  async listChanges(pageToken: string) {
    const res = await this.get('/changes', {
      ...this.common, pageToken, pageSize: '100', includeRemoved: 'true', restrictToMyDrive: 'false',
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
    });
    return (await res.json()) as { changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string };
  }

  /** Export HTML d'un Google Doc (lecture seule). Limite Google : 10 Mo. */
  async exportHtml(fileId: string): Promise<string> {
    const res = await this.get(`/files/${assertDriveId(fileId)}/export`, { mimeType: 'text/html' });
    return res.text();
  }
}

// ---------- Jetons OAuth (point d'accès Google OAuth, distinct de l'API Drive) ----------

export interface OAuthConfig { clientId: string; clientSecret: string }

/** Échange le jeton de renouvellement contre un jeton d'accès. Une autorisation révoquée devient `auth_revoked`. */
export async function refreshAccessToken(refreshToken: string, cfg: OAuthConfig, fetcher: FetchLike = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
  } catch {
    throw new DriveError('temporary', 'réseau');
  }
  if (res.ok) {
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new DriveError('unknown');
    return body.access_token;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 400 && (body.error === 'invalid_grant' || body.error === 'invalid_client' || body.error === 'unauthorized_client')) throw new DriveError('auth_revoked');
  if (res.status >= 500 || res.status === 429) throw new DriveError('temporary', `HTTP ${res.status}`);
  throw new DriveError('unknown', `HTTP ${res.status}`);
}

export async function revokeToken(token: string, fetcher: FetchLike = fetch): Promise<void> {
  try {
    await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  } catch {
    /* meilleure tentative : la suppression locale du jeton prime */
  }
}

/** Messages compréhensibles pour l'utilisateur. */
export const DRIVE_ERROR_MESSAGES: Record<string, string> = {
  auth_revoked: "L'autorisation d'accès à Google Drive a expiré ou a été retirée. Reconnectez votre Drive pour reprendre la synchronisation.",
  forbidden: "Ce document n'est pas accessible avec votre compte Google. Demandez l'accès au propriétaire du fichier.",
  not_found: "Ce document est introuvable : il a été supprimé ou n'est plus partagé avec votre compte.",
  rate_limited: 'Google limite temporairement les requêtes. Une nouvelle tentative aura lieu automatiquement.',
  temporary: 'Google Drive est momentanément indisponible. Une nouvelle tentative aura lieu automatiquement.',
  too_large: 'Ce document est trop volumineux pour être affiché ici. Ouvrez-le dans Google Docs.',
  unknown: 'Une erreur inattendue est survenue avec Google Drive.',
};
