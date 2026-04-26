import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { getPool } from '../utils/db';
import { createSignedUploadUrl, sanitizeFilename, normalizeLicenseType } from '../utils/s3';

const router = Router();

/**
 * GET /api/admin/overview - Get admin dashboard overview
 */
router.get('/overview', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const p = getPool();

    const [userCounts, gameCounts, recentUsers, recentGames] = await Promise.all([
      p.query(
        `SELECT
           COUNT(*)::int AS total_users,
           COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users,
           COUNT(*) FILTER (WHERE role = 'player')::int AS player_users
         FROM users`
      ),
      p.query(`SELECT COUNT(*)::int AS total_games FROM games`),
      p.query(`SELECT id, username, role, email FROM users ORDER BY username ASC LIMIT 5`),
      p.query(`SELECT id, title, category, price FROM games ORDER BY id DESC LIMIT 5`),
    ]);

    res.json({
      summary: {
        totalUsers: Number(userCounts.rows[0]?.total_users ?? 0),
        adminUsers: Number(userCounts.rows[0]?.admin_users ?? 0),
        playerUsers: Number(userCounts.rows[0]?.player_users ?? 0),
        totalGames: Number(gameCounts.rows[0]?.total_games ?? 0),
      },
      recentUsers: recentUsers.rows,
      recentGames: recentGames.rows,
    });
  } catch (err) {
    console.error('Failed to fetch admin overview:', err);
    res.status(500).json({ error: 'Failed to fetch admin overview' });
  }
});

/**
 * POST /api/admin/rom-upload-url - Get signed URL for ROM upload
 */
router.post('/rom-upload-url', requireAdmin, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const { gameId, filename, contentType, expiresInSeconds } = req.body ?? {};

    if (!gameId || !filename) {
      res.status(400).json({ error: 'gameId and filename are required' });
      return;
    }

    // Verify game exists
    const gameRes = await p.query(
      `SELECT id, title FROM games WHERE id = $1 LIMIT 1`,
      [String(gameId)]
    );

    if (gameRes.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const storageKey = `roms/${String(gameId)}/${sanitizeFilename(String(filename))}`;
    const uploadUrl = await createSignedUploadUrl(
      storageKey,
      contentType || 'application/octet-stream',
      expiresInSeconds || 300
    );

    res.json({
      gameId: gameRes.rows[0].id,
      title: gameRes.rows[0].title,
      uploadUrl,
      storageKey,
      expiresInSeconds: expiresInSeconds || 300,
    });
  } catch (err) {
    console.error('Failed to create ROM upload URL:', err);
    res.status(500).json({ error: 'Failed to create upload URL' });
  }
});

/**
 * POST /api/admin/register-rom - Register ROM metadata
 */
router.post('/register-rom', requireAdmin, async (req: Request, res: Response) => {
  try {
    const p = getPool();
    const { gameId, romStorageKey, romFilename, romSizeBytes, romSha256, licenseType, isDownloadable } = req.body ?? {};

    if (!gameId || !romStorageKey) {
      res.status(400).json({ error: 'gameId and romStorageKey are required' });
      return;
    }

    const updateRes = await p.query(
      `UPDATE games
       SET rom_storage_key = $1,
           rom_filename = $2,
           rom_size_bytes = $3,
           rom_sha256 = $4,
           license_type = $5,
           is_downloadable = $6
       WHERE id = $7
       RETURNING id, title, rom_storage_key, rom_filename, is_downloadable`,
      [
        String(romStorageKey),
        romFilename || null,
        romSizeBytes || null,
        romSha256 || null,
        normalizeLicenseType(licenseType),
        isDownloadable ?? true,
        String(gameId),
      ]
    );

    if (updateRes.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json({ game: updateRes.rows[0] });
  } catch (err) {
    console.error('Failed to register ROM:', err);
    res.status(500).json({ error: 'Failed to register ROM metadata' });
  }
});

export default router;
