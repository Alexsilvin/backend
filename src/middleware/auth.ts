import { Request, Response, NextFunction } from 'express';
import { getPool } from '../utils/db';
import { hashToken, parseCookies, getSessionCookieName } from '../utils/auth';
import { UserRow } from '../types';

/**
 * Extend Express Request to include user
 */
declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      userId?: string;
    }
  }
}

/**
 * Get session user from request
 */
export async function getSessionUser(req: Request): Promise<UserRow | null> {
  try {
    const p = getPool();
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[getSessionCookieName()];

    if (!token) return null;

    const tokenHash = hashToken(token);
    const result = await p.query<UserRow>(
      `SELECT u.id, u.username, u.avatar_url, u.role, u.email
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    return result.rows[0] ?? null;
  } catch (err) {
    console.error('Error getting session user:', err);
    return null;
  }
}

/**
 * Middleware: Require authentication
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ error: 'Authentication check failed' });
  }
}

/**
 * Middleware: Require admin role
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getSessionUser(req);

    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (err) {
    console.error('Admin check error:', err);
    res.status(500).json({ error: 'Admin check failed' });
  }
}

/**
 * Middleware: Check admin key
 */
export function checkAdminKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.ROM_ADMIN_KEY;
  if (!configuredKey) {
    next();
    return;
  }

  const providedKey = req.headers['x-admin-key'];
  if (providedKey !== configuredKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Middleware: Optional authentication (doesn't fail if not authenticated)
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await getSessionUser(req);
    if (user) {
      req.user = user;
      req.userId = user.id;
    }
    next();
  } catch (err) {
    console.error('Optional auth error:', err);
    next();
  }
}
