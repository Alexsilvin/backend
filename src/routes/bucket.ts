import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getPool } from '../utils/db';

const router = Router();

/**
 * GET /api/bucket - Get user's bucket items
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;

    const rows = await p.query<{ game_id: number }>(
      `SELECT game_id FROM bucket_items WHERE user_id = $1 ORDER BY added_at DESC`,
      [userId]
    );

    res.json({ gameIds: rows.rows.map((row) => String(row.game_id)) });
  } catch (err) {
    console.error('Failed to fetch bucket:', err);
    res.status(500).json({ error: 'Failed to fetch bucket' });
  }
});

/**
 * POST /api/bucket - Add item to bucket
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const { gameId } = req.body ?? {};

    if (!gameId) {
      res.status(400).json({ error: 'gameId is required' });
      return;
    }

    // Verify game exists
    const gameExists = await p.query(`SELECT id FROM games WHERE id = $1 LIMIT 1`, [gameId]);
    if (gameExists.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    await p.query(
      `INSERT INTO bucket_items (user_id, game_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [userId, gameId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to add bucket item:', err);
    res.status(500).json({ error: 'Failed to add bucket item' });
  }
});

/**
 * DELETE /api/bucket - Remove item from bucket
 */
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const { gameId } = req.body ?? {};

    if (!gameId) {
      res.status(400).json({ error: 'gameId is required' });
      return;
    }

    await p.query(
      `DELETE FROM bucket_items WHERE user_id = $1 AND game_id = $2`,
      [userId, gameId]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to remove bucket item:', err);
    res.status(500).json({ error: 'Failed to remove bucket item' });
  }
});

/**
 * PUT /api/bucket - Replace all bucket items
 */
router.put('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const userId = req.userId;
    const { gameIds } = req.body ?? {};

    if (!Array.isArray(gameIds)) {
      res.status(400).json({ error: 'gameIds must be an array' });
      return;
    }

    await p.query('BEGIN');

    try {
      await p.query(`DELETE FROM bucket_items WHERE user_id = $1`, [userId]);

      for (const gameId of gameIds) {
        const sanitizedId = String(gameId).trim();
        if (/^\d+$/.test(sanitizedId)) {
          await p.query(
            `INSERT INTO bucket_items (user_id, game_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, game_id) DO NOTHING`,
            [userId, sanitizedId]
          );
        }
      }

      await p.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await p.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('Failed to replace bucket items:', err);
    res.status(500).json({ error: 'Failed to replace bucket items' });
  }
});

export default router;
