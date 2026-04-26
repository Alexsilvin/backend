import type { IncomingMessage, ServerResponse } from "http";
import { Pool } from "pg";
import crypto from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SESSION_COOKIE_NAME = "neon-grid-session";

let pool: Pool | null = null;
let s3Client: S3Client | null = null;

function getPool(): Pool | null {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    pool = new Pool({ connectionString });
  }
  return pool;
}

function getS3Client(): S3Client {
  if (!s3Client) {
    const region = process.env.S3_REGION || "auto";
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("S3_SIGNING_CONFIG_MISSING");
    }

    s3Client = new S3Client({
      region,
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    });
  }

  return s3Client;
}

function getBucket(): string | null {
  return (
    process.env.S3_BUCKET ||
    process.env.FILEBASE_BUCKET ||
    process.env.S3_BUCKET_NAME ||
    process.env.FILEBASE_BUCKET_NAME ||
    null
  );
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
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
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export default async function games(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const p = getPool();
  if (!p) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Database not configured" }));
    return;
  }

  res.setHeader("Content-Type", "application/json");

  try {
    const baseUrl = `http://${req.headers.host || "localhost"}`;
    const requestUrl = new URL(req.url || "/api/games", baseUrl);

    // GET /api/games - list all games
    if (req.method === "GET" && requestUrl.pathname === "/api/games") {
      try {
        const result = await p.query("SELECT * FROM games ORDER BY id DESC");
        res.statusCode = 200;
        res.end(JSON.stringify(result.rows));
      } catch (error) {
        console.error("Failed to load catalog, returning empty list:", error);
        res.statusCode = 200;
        res.end(JSON.stringify([]));
      }
      return;
    }

    // POST /api/games?action=download-url - get signed download URL for game ROM
    if (req.method === "POST" && requestUrl.pathname === "/api/games" && requestUrl.searchParams.get("action") === "download-url") {
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies[SESSION_COOKIE_NAME];

      if (!token) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Not authenticated" }));
        return;
      }

      const tokenHash = hashToken(token);
      const sessionResult = await p.query(
        `SELECT u.id FROM auth_sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`,
        [tokenHash]
      );

      if (sessionResult.rows.length === 0) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Not authenticated" }));
        return;
      }

      const userId = sessionResult.rows[0].id;
      const body = (await readJsonBody(req)) as { gameId?: unknown; expiresInSeconds?: unknown };
      const gameId = body.gameId;

      if (!gameId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "gameId is required" }));
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
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Game not found" }));
        return;
      }

      const game = gameRes.rows[0];
      if (!game.is_downloadable || !game.rom_storage_key) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "This game is not downloadable" }));
        return;
      }

      const requireLibrary = process.env.DOWNLOAD_REQUIRE_LIBRARY === "true";
      if (requireLibrary) {
        const entitlementRes = await p.query(
          `SELECT 1 FROM library WHERE user_id = $1 AND game_id = $2 LIMIT 1`,
          [userId, gameId]
        );

        if (entitlementRes.rows.length === 0) {
          res.statusCode = 403;
          res.end(JSON.stringify({ error: "User does not own this game" }));
          return;
        }
      }

      const bucket = getBucket();
      if (!bucket) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "Bucket is not configured. Set S3_BUCKET (or FILEBASE_BUCKET/S3_BUCKET_NAME/FILEBASE_BUCKET_NAME).",
          })
        );
        return;
      }

      const expiresInSeconds = Math.min(Math.max(typeof body.expiresInSeconds === "number" ? body.expiresInSeconds : 60, 30), 300);

      const client = getS3Client();
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: game.rom_storage_key,
        ResponseContentDisposition: `attachment; filename="${game.rom_filename || `${game.title}.zip`}"`,
      });

      const signedUrl = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          gameId: game.id,
          title: game.title,
          userId,
          signedUrl,
          expiresInSeconds,
        })
      );
      return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
  } catch (error) {
    console.error("Failed to handle games request:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed to handle games request" }));
  }
}
