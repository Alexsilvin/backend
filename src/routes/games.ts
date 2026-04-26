import { Router, Request, Response } from 'express';
import { getPool } from '../utils/db.js';
import { createSignedDownloadUrl } from '../utils/s3.js';
import { getSessionUser } from '../middleware/auth.js';
import type { GameRow } from '../types/index.js';

const router = Router();

// Mock games fallback
const MOCK_GAMES: GameRow[] = [
  {
    id: '101',
    title: 'NEON STRIKE',
    price: 29.99,
    description: 'High-speed glitch combat in the digital void.',
    image: '/src/assets/images/neon-strike.jpg',
    category: 'Action',
    platform: 'PC / Console',
    is_downloadable: false,
    rom_storage_key: null,
    rom_filename: null,
    rating: '9.2/10',
  },
  {
    id: '102',
    title: 'VOID RUNNER',
    price: 19.99,
    description: 'Escape the collapsing simulation in this high-octane racing experience.',
    image: '/src/assets/images/void-runner.jpg',
    category: 'Racing',
    platform: 'PC',
    is_downloadable: false,
    rom_storage_key: null,
    rom_filename: null,
    rating: '8.5/10',
  },
  {
    id: '103',
    title: 'CYBER-SOUL',
    price: 39.99,
    description: 'A deep RPG set in a decaying megacity.',
    image: '/src/assets/images/cyber-soul.jpg',
    category: 'RPG',
    platform: 'PC / Cloud',
    is_downloadable: false,
    rom_storage_key: null,
    rom_filename: null,
    rating: '9.5/10',
  },
];

/**
 * GET /api/games - List all games
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const p = getPool();

    try {
      const result = await p.query('SELECT * FROM games ORDER BY id DESC');
      if (result.rows.length === 0) {
        res.json(MOCK_GAMES);
      } else {
        res.json(result.rows);
      }
    } catch (err) {
      console.warn('Database query failed, returning mock games:', err);
      res.json(MOCK_GAMES);
    }
  } catch (err) {
    console.error('Failed to fetch games:', err);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

/**
 * GET /api/games/:id - Get single game
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const { id } = req.params;

    const result = await p.query('SELECT * FROM games WHERE id = $1 LIMIT 1', [id]);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to fetch game:', err);
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

/**
 * POST /api/games/download-url - Get signed download URL
 */
router.post('/download-url', async (req: Request, res: Response) => {
  try {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const p = getPool();
    const { gameId, expiresInSeconds } = req.body ?? {};

    if (!gameId) {
      res.status(400).json({ error: 'gameId is required' });
      return;
    }

    const gameRes = await p.query(
      `SELECT id, title, rom_storage_key, rom_filename, is_downloadable
       FROM games
       WHERE id = $1
       LIMIT 1`,
      [gameId]
    );

    if (gameRes.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const game = gameRes.rows[0];
    if (!game.is_downloadable || !game.rom_storage_key) {
      res.status(400).json({ error: 'This game is not downloadable' });
      return;
    }

    // Check library if required
    const requireLibrary = process.env.DOWNLOAD_REQUIRE_LIBRARY === 'true';
    if (requireLibrary) {
      const entitlementRes = await p.query(
        `SELECT 1 FROM library WHERE user_id = $1 AND game_id = $2 LIMIT 1`,
        [user.id, gameId]
      );

      if (entitlementRes.rows.length === 0) {
        res.status(403).json({ error: 'User does not own this game' });
        return;
      }
    }

    const signedUrl = await createSignedDownloadUrl(
      game.rom_storage_key,
      game.rom_filename || `${game.title}.zip`,
      expiresInSeconds || 60
    );

    res.json({
      gameId: game.id,
      title: game.title,
      signedUrl,
      expiresInSeconds: expiresInSeconds || 60,
    });
  } catch (err) {
    console.error('Failed to generate download URL:', err);
    res.status(500).json({ error: 'Failed to create signed download URL' });
  }
});

export default router;
