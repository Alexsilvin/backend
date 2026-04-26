import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'neon-grid-session';
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MS || '604800000', 10);

/**
 * Hash a password with a salt
 */
export function hashPassword(
  password: string,
  salt = crypto.randomBytes(16).toString('hex')
): { salt: string; hash: string } {
  const hash = crypto
    .pbkdf2Sync(password, salt, 120_000, 64, 'sha512')
    .toString('hex');
  return { salt, hash };
}

/**
 * Verify a password against a hash
 */
export function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string
): boolean {
  try {
    const actualHash = crypto
      .pbkdf2Sync(password, salt, 120_000, 64, 'sha512')
      .toString('hex');
    return crypto.timingSafeEqual(
      Buffer.from(actualHash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Hash a token (for session storage)
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a session token
 */
export function createSessionToken(): string {
  return `${crypto.randomUUID()}.${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Get session cookie options
 */
export function getCookieOptions(): {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/**
 * Parse cookies from header
 */
export function parseCookies(
  cookieHeader: string | undefined
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

/**
 * Get session expiration date
 */
export function getSessionExpiration(): Date {
  return new Date(Date.now() + SESSION_TTL_MS);
}

/**
 * Get cookie name
 */
export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
