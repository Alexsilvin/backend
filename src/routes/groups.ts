import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getPool } from '../utils/db.js';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const result = await p.query(
      `SELECT mg.id, mg.name, mg.description, mg.is_public, mg.creator_id, mg.created_at, mg.updated_at,
              COUNT(gm.user_id)::int AS member_count,
              u.username AS creator_username
       FROM message_groups mg
       JOIN group_members gm ON mg.id = gm.group_id
       JOIN users u ON u.id = mg.creator_id
       WHERE mg.id IN (
         SELECT group_id FROM group_members WHERE user_id = $1
       )
       GROUP BY mg.id, u.username
       ORDER BY mg.updated_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch groups:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  const p = getPool();
  const userId = req.userId!;
  const { name, description, isPublic } = req.body ?? {};

  if (!name) {
    res.status(400).json({ error: 'Group name required' });
    return;
  }

  try {
    await p.query('BEGIN');
    const groupResult = await p.query(
      `INSERT INTO message_groups (name, description, creator_id, is_public)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, is_public, creator_id, created_at, updated_at`,
      [String(name).trim(), description || null, userId, isPublic !== false]
    );

    await p.query(
      `INSERT INTO group_members (group_id, user_id, is_admin)
       VALUES ($1, $2, true)`,
      [groupResult.rows[0].id, userId]
    );

    await p.query('COMMIT');
    res.status(201).json(groupResult.rows[0]);
  } catch (err) {
    await p.query('ROLLBACK').catch(() => undefined);
    console.error('Failed to create group:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

router.get('/:groupId/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const { groupId } = req.params;

    const membership = await p.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [groupId, userId]
    );

    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await p.query(
      `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at,
              u.username AS sender_username
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       WHERE gm.group_id = $1
       ORDER BY gm.created_at ASC
       LIMIT 100`,
      [groupId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch group messages:', err);
    res.status(500).json({ error: 'Failed to fetch group messages' });
  }
});

router.post('/:groupId/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId!;
    const { groupId } = req.params;
    const { content } = req.body ?? {};

    if (!content) {
      res.status(400).json({ error: 'Message content required' });
      return;
    }

    const membership = await p.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 LIMIT 1`,
      [groupId, userId]
    );

    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await p.query(
      `INSERT INTO group_messages (group_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, group_id, sender_id, content, created_at`,
      [groupId, userId, String(content).trim()]
    );

    await p.query(`UPDATE message_groups SET updated_at = NOW() WHERE id = $1`, [groupId]);

    const withUsername = await p.query(
      `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at, u.username AS sender_username
       FROM group_messages gm
       JOIN users u ON u.id = gm.sender_id
       WHERE gm.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(withUsername.rows[0]);
  } catch (err) {
    console.error('Failed to send group message:', err);
    res.status(500).json({ error: 'Failed to send group message' });
  }
});

export default router;
