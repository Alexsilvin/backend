import type { IncomingMessage, ServerResponse } from "http";
import crypto from "crypto";
import { Pool } from "pg";

const SESSION_COOKIE_NAME = "neon-grid-session";

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    const { Pool: PgPool } = require("pg");
    pool = new PgPool({ connectionString });
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

function buildClearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production";
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

async function ensureAuthSchema(p: any): Promise<void> {
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

export default async function logout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const p = getPool();
  if (!p) {
    res.statusCode = 200;
    res.setHeader("Set-Cookie", buildClearedSessionCookie());
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  try {
    await ensureAuthSchema(p);

    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];

    if (token) {
      const tokenHash = hashToken(token);
      await p.query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
    }

    const clearedCookie = buildClearedSessionCookie();

    res.statusCode = 200;
    res.setHeader("Set-Cookie", clearedCookie);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    console.error("Logout failed:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed to log out" }));
  }
}
