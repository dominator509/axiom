import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_AGE_SECONDS = OAUTH_STATE_TTL_MS / 1000;
const IV_BYTES = 12;

export type OAuthStatePayload = {
  state: string;
  verifier?: string;
  issuedAt: number;
};

function cookieKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Seal short-lived OAuth state so the verifier never appears in the URL or plaintext cookie. */
function seal(payload: OAuthStatePayload, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function unseal(value: string, secret: string): OAuthStatePayload | null {
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.');
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return null;

    const decipher = createDecipheriv(
      'aes-256-gcm',
      cookieKey(secret),
      Buffer.from(ivEncoded, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as Partial<OAuthStatePayload>;

    if (
      typeof payload.state !== 'string' ||
      typeof payload.issuedAt !== 'number' ||
      (payload.verifier !== undefined && typeof payload.verifier !== 'string')
    ) {
      return null;
    }

    const age = Date.now() - payload.issuedAt;
    if (age < -30_000 || age > OAUTH_STATE_TTL_MS) return null;
    return payload as OAuthStatePayload;
  } catch {
    return null;
  }
}

export function setOAuthStateCookie(
  c: Context,
  name: string,
  payload: OAuthStatePayload,
  secret: string,
  path: string,
): void {
  setCookie(c, name, seal(payload, secret), {
    httpOnly: true,
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    path,
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export function getOAuthStateCookie(
  c: Context,
  name: string,
  secret: string,
): OAuthStatePayload | null {
  const value = getCookie(c, name);
  return value ? unseal(value, secret) : null;
}

export function clearOAuthStateCookie(c: Context, name: string, path: string): void {
  deleteCookie(c, name, { path });
}
