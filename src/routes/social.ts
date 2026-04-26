import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../utils/db.js';

const router = Router();

/**
 * GET /api/friends - Get friend list or search users
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const searchTerm = (req.query.search as string)?.trim() || '';

    if (searchTerm) {
      const result = await p.query(
        `SELECT u.id, u.username, u.avatar_url, COALESCE(u.role, 'player')::text AS role, u.email,
                EXISTS(SELECT 1 FROM friends f WHERE f.user_id = $1 AND f.friend_id = u.id AND f.status = 'accepted') AS is_friend
         FROM users u WHERE u.id <> $1 AND (u.username ILIKE $2 || '%' OR u.username ILIKE '%' || $2 || '%')
         ORDER BY CASE WHEN u.username ILIKE $2 || '%' THEN 0 ELSE 1 END, u.username ASC LIMIT 8`,
        [userId, searchTerm.slice(0, 40)]
      );

      res.json({ users: result.rows });
    } else {
      const result = await p.query(
        `SELECT f.id, u.username,
                CASE WHEN EXISTS(SELECT 1 FROM auth_sessions s2 WHERE s2.user_id = u.id AND s2.expires_at > NOW()) THEN 'online' ELSE 'offline' END::text AS status
         FROM friends f INNER JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND f.status = 'accepted' ORDER BY u.username ASC`,
        [userId]
      );

      res.json({ friends: result.rows });
    }
  } catch (err) {
    console.error('Failed to fetch friends:', err);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

/**
 * POST /api/friends - Add friend
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const { username: targetUsername } = req.body ?? {};

    if (!targetUsername || typeof targetUsername !== 'string') {
      res.status(400).json({ error: 'username is required' });
      return;
    }

    const target = await p.query(`SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [
      targetUsername.trim(),
    ]);

    if (target.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const friend = target.rows[0];

    try {
      await p.query('BEGIN');

      await p.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = EXCLUDED.status`,
        [userId, friend.id]
      );

      await p.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = EXCLUDED.status`,
        [friend.id, userId]
      );

      const currentUser = await p.query(`SELECT username FROM users WHERE id = $1`, [userId]);

      await p.query(
        `INSERT INTO notifications (user_id, type, actor_id, message, is_read) 
         VALUES ($1, 'friend', $2, $3, false)`,
        [
          friend.id,
          userId,
          `${currentUser.rows[0]?.username} added you to GRID_CONTACTS.`,
        ]
      );

      await p.query('COMMIT');

      res.status(201).json({ ok: true });
    } catch (error) {
      await p.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } catch (err) {
    console.error('Failed to add friend:', err);
    res.status(500).json({ error: 'Failed to add friend' });
  }
});

/**
 * GET /api/notifications - Get notifications
 */
router.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;

    const result = await p.query(
      `SELECT n.id, n.type, n.message, n.is_read, n.created_at, actor.username as actor_username
       FROM notifications n LEFT JOIN users actor ON actor.id = n.actor_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
      [userId]
    );

    const notifications = result.rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      title: row.actor_username ? `${row.actor_username.toUpperCase()} // ${row.type.toUpperCase()}` : row.type.toUpperCase(),
      message: row.message ?? 'New activity in your account.',
      time: row.created_at,
      read: row.is_read,
    }));

    res.json({ notifications });
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * PATCH /api/notifications - Mark notifications as read
 */
router.patch('/notifications', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const action = (req.query.action as string)?.toLowerCase() || '';

    if (action === 'mark-all-read') {
      await p.query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [userId]);
      res.json({ ok: true });
    } else {
      res.status(400).json({ error: 'Unsupported notification action' });
    }
  } catch (err) {
    console.error('Failed to update notifications:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

/**
 * DELETE /api/notifications - Delete notifications
 */
router.delete('/notifications', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const id = (req.query.id as string)?.trim();

    if (id) {
      await p.query(`DELETE FROM notifications WHERE user_id = $1 AND id = $2`, [userId, id]);
    } else {
      await p.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete notifications:', err);
    res.status(500).json({ error: 'Failed to delete notifications' });
  }
});

export default router;
