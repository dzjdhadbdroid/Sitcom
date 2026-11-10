// Primitives de sécurité basées sur Web Crypto (identiques dans Workers, navigateurs et Node).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Jeton aléatoire cryptographiquement sûr (256 bits par défaut). */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Comparaison en temps constant de deux chaînes. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function importKey(keyB64Url: string): Promise<CryptoKey> {
  const raw = fromBase64Url(keyB64Url);
  if (raw.length !== 32) throw new Error('La clé de chiffrement doit faire exactement 32 octets (base64url).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Chiffre un texte (ex. jeton Google). Format : v1.<iv>.<chiffré>. */
export async function encryptText(plain: string, keyB64Url: string): Promise<string> {
  const key = await importKey(keyB64Url);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return `v1.${toBase64Url(iv)}.${toBase64Url(ct)}`;
}

export async function decryptText(payload: string, keyB64Url: string): Promise<string> {
  const [version, ivPart, ctPart] = payload.split('.');
  if (version !== 'v1' || !ivPart || !ctPart) throw new Error('Format de données chiffrées invalide.');
  const key = await importKey(keyB64Url);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivPart) }, key, fromBase64Url(ctPart));
  return dec.decode(plain);
}
