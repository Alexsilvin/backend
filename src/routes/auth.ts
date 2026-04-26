import { Router, Request, Response } from 'express';
import { getPool } from '../utils/db';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  createSessionToken,
  getCookieOptions,
  getSessionExpiration,
  getSessionCookieName,
  parseCookies,
} from '../utils/auth';
import { getSessionUser } from '../middleware/auth';
import type { UserRow, AuthSessionResponse } from '../types';

const router = Router();

/**
 * POST /api/auth/signup - Create a new account
 */
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const { username, email, password } = req.body ?? {};

    // Validation
    if (!username || !password || !email) {
      res.status(400).json({ error: 'username, email, and password are required' });
      return;
    }

    if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Invalid signup payload' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    // Hash password
    const passwordData = hashPassword(password);

    // Create user
    const result = await p.query<UserRow>(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ($1, $2, $3, $4, 'player')
       RETURNING id, username, avatar_url, role, email`,
      [username.trim(), email.trim().toLowerCase(), passwordData.hash, passwordData.salt]
    );

    if (result.rows.length === 0) {
      res.status(400).json({ error: 'Failed to create user' });
      return;
    }

    // Issue session
    const token = createSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = getSessionExpiration();

    await p.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, result.rows[0].id, expiresAt.toISOString()]
    );

    res.cookie(getSessionCookieName(), token, getCookieOptions());
    res.status(201).json(result.rows[0] as AuthSessionResponse);
  } catch (err) {
    console.error('Signup failed:', err);
    if (err instanceof Error && err.message.includes('duplicate')) {
      res.status(409).json({ error: 'Username or email already exists' });
    } else {
      res.status(500).json({ error: 'Failed to sign up' });
    }
  }
});

/**
 * POST /api/auth/login - Authenticate user
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const { username, password } = req.body ?? {};

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'username and password are required' });
      return;
    }

    // Find user
    const result = await p.query<
      UserRow & { password_hash: string | null; password_salt: string | null }
    >(
      `SELECT id, username, avatar_url, role, email, password_hash, password_salt
       FROM users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [username.trim()]
    );

    const user = result.rows[0];

    // Verify password
    if (
      !user ||
      !user.password_hash ||
      !user.password_salt ||
      !verifyPassword(password, user.password_salt, user.password_hash)
    ) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    // Issue session
    const token = createSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = getSessionExpiration();

    await p.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [tokenHash, user.id, expiresAt.toISOString()]
    );

    res.cookie(getSessionCookieName(), token, getCookieOptions());
    res.json({
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      role: user.role,
      email: user.email,
    } as AuthSessionResponse);
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

/**
 * GET /api/auth/me - Get current session user
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const user = await getSessionUser(req);

    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    res.json(user);
  } catch (err) {
    console.error('Session check failed:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * POST /api/auth/logout - End session
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[getSessionCookieName()];

    if (token) {
      const tokenHash = hashToken(token);
      await p.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
    }

    res.clearCookie(getSessionCookieName(), { path: '/' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Logout failed:', err);
    res.status(500).json({ error: 'Failed to log out' });
  }
});

export default router;
