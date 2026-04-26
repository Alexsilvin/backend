import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../utils/db.js';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;

    const result = await p.query(
      `SELECT n.id, n.type, n.message, n.is_read, n.created_at, actor.username as actor_username
       FROM notifications n
       LEFT JOIN users actor ON actor.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 100`,
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

router.patch('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const action = (req.query.action as string)?.toLowerCase() || '';

    if (action !== 'mark-all-read') {
      res.status(400).json({ error: 'Unsupported notification action' });
      return;
    }

    await p.query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to update notifications:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.delete('/', requireAuth, async (req: Request, res: Response) => {
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
