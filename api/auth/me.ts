import type { IncomingMessage, ServerResponse } from "http";
import { Pool } from "pg";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "neon-grid-session";

type SessionUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  role: "admin" | "player";
  email: string | null;
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
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

async function ensureAuthSchema(p: Pool): Promise<void> {
  await p.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT UNIQUE,
      avatar_url TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      password_salt TEXT,
      role TEXT NOT NULL DEFAULT 'player'
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      title TEXT,
      price REAL,
      description TEXT,
      image TEXT,
      category TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      is_downloadable BOOLEAN DEFAULT false,
      rom_storage_key TEXT,
      rom_filename TEXT,
      rom_size_bytes INT,
      rom_sha256 TEXT
    );
    CREATE TABLE IF NOT EXISTS library_items (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      purchased_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, game_id)
    );
    CREATE TABLE IF NOT EXISTS friends (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'accepted',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, friend_id),
      CHECK (user_id != friend_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
      game_id INT REFERENCES games(id) ON DELETE SET NULL,
      friend_request_id UUID REFERENCES friends(id) ON DELETE CASCADE,
      message TEXT,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS is_downloadable BOOLEAN DEFAULT false;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS rom_storage_key TEXT;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS rom_filename TEXT;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS rom_size_bytes INT;`);
  await p.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS rom_sha256 TEXT;`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (email) WHERE email IS NOT NULL;`);
}

export default async function me(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const p = getPool();
  if (!p) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Database not configured" }));
    return;
  }

  try {
    await ensureAuthSchema(p);

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    const tokenHash = hashToken(token);
    const result = await p.query<SessionUser>(
      `SELECT u.id, u.username, u.avatar_url, u.role, u.email
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    const row = result.rows[0];
    if (!row) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Not authenticated" }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(row));
  } catch (error) {
    console.error("Session check failed:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed to fetch session" }));
  }
}
