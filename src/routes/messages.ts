import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../utils/db.js';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const otherUserId = typeof req.query.with === 'string' ? req.query.with : '';

    if (otherUserId) {
      const result = await p.query(
        `SELECT m.id, m.sender_id, m.recipient_id, m.content, m.is_read, m.created_at,
                s.username as sender_username, r.username as recipient_username
         FROM messages m
         LEFT JOIN users s ON m.sender_id = s.id
         LEFT JOIN users r ON m.recipient_id = r.id
         WHERE (m.sender_id = $1 AND m.recipient_id = $2)
            OR (m.sender_id = $2 AND m.recipient_id = $1)
         ORDER BY m.created_at ASC
         LIMIT 100`,
        [userId, otherUserId]
      );

      res.json(result.rows);
      return;
    }

    const result = await p.query(
      `WITH latest_messages AS (
         SELECT
           CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_user_id,
           MAX(created_at) AS latest_at
         FROM messages
         WHERE sender_id = $1 OR recipient_id = $1
         GROUP BY CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END
       )
       SELECT
         lm.other_user_id,
         u.username,
         u.avatar_url AS avatar,
         m.content AS last_message,
         m.created_at AS last_message_at,
         COUNT(unread.id)::int AS unread_count
       FROM latest_messages lm
       JOIN users u ON u.id = lm.other_user_id
       JOIN messages m ON (
         ((m.sender_id = $1 AND m.recipient_id = lm.other_user_id)
         OR (m.sender_id = lm.other_user_id AND m.recipient_id = $1))
         AND m.created_at = lm.latest_at
       )
       LEFT JOIN messages unread ON unread.sender_id = lm.other_user_id
         AND unread.recipient_id = $1
         AND COALESCE(unread.is_read, false) = false
       GROUP BY lm.other_user_id, u.username, u.avatar_url, m.content, m.created_at
       ORDER BY m.created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const { recipientId, content } = req.body ?? {};

    if (!recipientId || !content) {
      res.status(400).json({ error: 'Missing recipientId or content' });
      return;
    }

    const result = await p.query(
      `INSERT INTO messages (sender_id, recipient_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, content, is_read, created_at`,
      [userId, recipientId, String(content).trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to send message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.patch('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const { senderId } = req.body ?? {};

    if (!senderId) {
      res.status(400).json({ error: 'Missing senderId' });
      return;
    }

    await p.query(
      `UPDATE messages
       SET is_read = true, read_at = NOW()
       WHERE recipient_id = $1 AND sender_id = $2`,
      [userId, senderId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to mark messages as read:', err);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

export default router;
