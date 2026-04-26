import type { IncomingMessage, ServerResponse } from "http";
import { Pool } from "pg";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "neon-grid-session";

type SessionUser = {
  id: string;
  username: string;
};

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    pool = new Pool({ connectionString });
  }
  return pool;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }

  return cookies;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function ensureBucketSchema(p: Pool): Promise<void> {
  await p.query(`
    CREATE TABLE IF NOT EXISTS bucket_items (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, game_id)
    );
  `);
}

async function getSessionUser(p: Pool, req: IncomingMessage): Promise<SessionUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const result = await p.query<SessionUser>(
    `SELECT u.id, u.username
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

function getGameIdFromUrl(req: IncomingMessage): string {
  const base = `http://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/bucket", base);
  return (url.searchParams.get("gameId") || "").trim();
}

export default async function bucket(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const p = getPool();
  if (!p) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Database not configured" }));
    return;
  }

  try {
    await ensureBucketSchema(p);

    const user = await getSessionUser(p, req);
    if (!user) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    if (req.method === "GET") {
      const rows = await p.query<{ game_id: number }>(
        `SELECT game_id
         FROM bucket_items
         WHERE user_id = $1
         ORDER BY added_at DESC`,
        [user.id]
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ gameIds: rows.rows.map((row) => String(row.game_id)) }));
      return;
    }

    if (req.method === "POST") {
      const body = (await readJsonBody(req)) as { gameId?: unknown };
      const gameId = typeof body.gameId === "string" || typeof body.gameId === "number" ? String(body.gameId).trim() : "";

      if (!gameId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "gameId is required" }));
        return;
      }

      const gameExists = await p.query(`SELECT id FROM games WHERE id = $1 LIMIT 1`, [gameId]);
      if (gameExists.rows.length === 0) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Game not found" }));
        return;
      }

      await p.query(
        `INSERT INTO bucket_items (user_id, game_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [user.id, gameId]
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "DELETE") {
      let gameId = getGameIdFromUrl(req);
      if (!gameId) {
        const body = (await readJsonBody(req)) as { gameId?: unknown };
        gameId = typeof body.gameId === "string" || typeof body.gameId === "number" ? String(body.gameId).trim() : "";
      }

      if (!gameId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "gameId is required" }));
        return;
      }

      await p.query(
        `DELETE FROM bucket_items
         WHERE user_id = $1 AND game_id = $2`,
        [user.id, gameId]
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "PUT") {
      const body = (await readJsonBody(req)) as { gameIds?: unknown };
      const gameIds = Array.isArray(body.gameIds)
        ? body.gameIds
            .map((id) => String(id).trim())
            .filter((id) => /^\d+$/.test(id))
        : [];

      await p.query(`BEGIN`);
      await p.query(`DELETE FROM bucket_items WHERE user_id = $1`, [user.id]);

      for (const gameId of gameIds) {
        await p.query(
          `INSERT INTO bucket_items (user_id, game_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [user.id, gameId]
        );
      }

      await p.query(`COMMIT`);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
  } catch (error) {
    await p.query(`ROLLBACK`).catch(() => undefined);
    console.error("Bucket API failed:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Bucket request failed" }));
  }
}
