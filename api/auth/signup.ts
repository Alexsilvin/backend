import type { IncomingMessage, ServerResponse } from "http";
import { Pool } from "pg";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "neon-grid-session";

type UserRow = {
  id: string;
  username: string;
  avatar_url: string | null;
  role: "admin" | "player";
  email: string | null;
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    pool = new Pool({ connectionString });
  }
  return pool;
}

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createSessionToken(): string {
  return `${crypto.randomUUID()}.${crypto.randomBytes(24).toString("hex")}`;
}

function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production";
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

async function issueSession(p: Pool, userId: string): Promise<string> {
  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await p.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, userId, expiresAt.toISOString()]
  );
  return buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000));
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
    CREATE TABLE IF NOT EXISTS bucket_items (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ DEFAULT NOW(),
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

  const admin = getAdminBootstrapCredentials();
  const adminCredentials = hashPassword(admin.password);
  await p.query(
    `INSERT INTO users (username, avatar_url, email, password_hash, password_salt, role)
     VALUES ($1, NULL, $2, $3, $4, 'admin')
     ON CONFLICT (username)
     DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt`,
    [admin.username, admin.email, adminCredentials.hash, adminCredentials.salt]
  );

  const res = await p.query("SELECT COUNT(*) FROM games");
  if (parseInt(res.rows[0].count) === 0) {
    const insertQuery = "INSERT INTO games (title, price, description, image, category) VALUES ($1, $2, $3, $4, $5)";
    const games = [
      ["NEON STRIKE", 29.99, "High-speed glitch combat in the digital void. Master the art of code-warfare.", "https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&q=80&w=1200", "Action"],
      ["VOID RUNNER", 19.99, "Escape the collapsing simulation in this high-octane racing experience.", "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1200", "Racing"],
      ["CYBER-SOUL", 39.99, "A deep RPG set in a decaying megacity. Every choice alters the grid's fate.", "https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=1200", "RPG"],
      ["GLITCH-BIT", 14.99, "Retro platforming with a broken twist. Navigate through fragmented data.", "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=1200", "Platformer"],
      ["TERMINAL VELOCITY", 24.99, "Tactical shooter in a low-poly digital landscape. Precision is everything.", "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=1200", "Shooter"],
      ["DATA DRIFTER", 9.99, "Zen-like strategy game about navigating the streams of information.", "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=1200", "Strategy"]
    ];
    for (const game of games) {
      await p.query(insertQuery, game);
    }
  }
}

function getAdminBootstrapCredentials(): {
  username: string;
  password: string;
  email: string;
} {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "admin";
  return {
    username,
    password: process.env.ADMIN_BOOTSTRAP_PASSWORD || "Admin1234!",
    email: process.env.ADMIN_BOOTSTRAP_EMAIL || `${username}@local.admin`,
  };
}

function sanitizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 40) : "";
}

function sanitizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 160) : "";
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

export default async function signup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
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

    const body = (await readJsonBody(req)) as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
    };

    const username = sanitizeUsername(body.username);
    const email = sanitizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !email || password.length < 6) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Invalid signup payload" }));
      return;
    }

    const existingUser = await p.query(
      `SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2) LIMIT 1`,
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      res.statusCode = 409;
      res.end(JSON.stringify({ error: "Username or email already exists" }));
      return;
    }

    const credentials = hashPassword(password);

    const created = await p.query<UserRow>(
      `INSERT INTO users (username, email, password_hash, password_salt, role)
       VALUES ($1, $2, $3, $4, 'player')
       RETURNING id, username, avatar_url, role, email`,
      [username, email, credentials.hash, credentials.salt]
    );

    const user = created.rows[0];
    const sessionCookie = await issueSession(p, user.id);

    res.statusCode = 201;
    res.setHeader("Set-Cookie", sessionCookie);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(user));
  } catch (error) {
    console.error("Signup failed:", error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed to sign up" }));
  }
}
