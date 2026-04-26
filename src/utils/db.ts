import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let pool: Pool | null = null;

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return undefined;
}

function shouldUseSsl(connectionString: string): boolean {
  const envOverride = parseBooleanEnv(process.env.DB_SSL);
  if (envOverride !== undefined) {
    return envOverride;
  }

  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();

    if (sslMode && sslMode !== 'disable') {
      return true;
    }

    // Remote managed Postgres providers generally require TLS.
    if (/neon\.tech|supabase\.co|render\.com/i.test(parsed.hostname)) {
      return true;
    }
  } catch {
    // Fall through to environment heuristic.
  }

  return process.env.NODE_ENV === 'production';
}

/**
 * Get or create the PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const useSsl = shouldUseSsl(connectionString);
    const connectionTimeoutMillis = Number(process.env.DB_CONNECT_TIMEOUT_MS || '10000');

    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

/**
 * Close the database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Initialize database schema
 */
export async function initializeDatabase(): Promise<void> {
  const p = getPool();

  try {
    console.log('Initializing database schema...');

    await p.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT UNIQUE NOT NULL,
        avatar_url TEXT,
        email TEXT UNIQUE,
        password_hash TEXT,
        password_salt TEXT,
        role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin'))
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        description TEXT,
        image TEXT,
        category TEXT,
        platform TEXT,
        publisher TEXT,
        edition TEXT,
        stock_quantity INT NOT NULL DEFAULT 0,
        warehouse_zone TEXT,
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        rom_storage_key TEXT,
        rom_filename TEXT,
        rom_size_bytes BIGINT,
        rom_sha256 TEXT,
        license_type TEXT,
        is_downloadable BOOLEAN NOT NULL DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS library (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS bucket_items (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS friends (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'accepted',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, friend_id),
        CHECK (user_id <> friend_id)
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
        transaction_type TEXT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS payment_methods (
        id TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        provider TEXT NOT NULL,
        last_four TEXT,
        is_default BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        customer_tier TEXT NOT NULL DEFAULT 'rookie',
        subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency_code CHAR(3) NOT NULL DEFAULT 'XAF',
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        quantity INT NOT NULL DEFAULT 1,
        unit_price NUMERIC(12,2) NOT NULL,
        discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (order_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
        wallet_transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
        amount NUMERIC(12,2) NOT NULL,
        currency_code CHAR(3) NOT NULL DEFAULT 'XAF',
        status TEXT NOT NULL DEFAULT 'completed',
        provider TEXT NOT NULL DEFAULT 'wallet',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS game_purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
        price_paid NUMERIC(12,2) NOT NULL,
        purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, game_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT false,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS message_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT,
        creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_public BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (group_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS group_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        message TEXT,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Bootstrap admin user
    await bootstrapAdmin();

    // Seed games if empty
    await seedGamesIfEmpty();

    console.log('✓ Database schema initialized successfully');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  }
}

/**
 * Bootstrap admin user
 */
async function bootstrapAdmin(): Promise<void> {
  const p = getPool();
  const crypto = await import('crypto');

  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'Admin1234!';
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || `${username}@local.admin`;

  // Hash password
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 120_000, 64, 'sha512')
    .toString('hex');

  await p.query(
    `INSERT INTO users (username, email, password_hash, password_salt, role)
     VALUES ($1, $2, $3, $4, 'admin')
     ON CONFLICT (username)
     DO UPDATE SET role = 'admin', password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt`,
    [username, email, hash, salt]
  );
}

/**
 * Seed initial games if the catalog is empty
 */
async function seedGamesIfEmpty(): Promise<void> {
  const p = getPool();

  const res = await p.query('SELECT COUNT(*) as count FROM games');
  if (parseInt(res.rows[0].count) > 0) {
    return;
  }

  const games = [
    [
      'NEON STRIKE',
      29.99,
      'High-speed glitch combat in the digital void. Master the art of code-warfare.',
      'https://images.unsplash.com/photo-1614850523296-d8c1af93d400?auto=format&fit=crop&q=80&w=1200',
      'Action',
      'PC / Console',
      'GridForge',
      "Collector's Cut",
      18,
      'A1',
      0,
    ],
    [
      'VOID RUNNER',
      19.99,
      'Escape the collapsing simulation in this high-octane racing experience.',
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1200',
      'Racing',
      'PC',
      'GridForge',
      'Standard',
      24,
      'B2',
      0,
    ],
    [
      'CYBER-SOUL',
      39.99,
      'A deep RPG set in a decaying megacity. Every choice alters the grid\'s fate.',
      'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=1200',
      'RPG',
      'PC / Cloud',
      'Neon Atlas',
      'Deluxe',
      12,
      'C1',
      5,
    ],
  ];

  for (const game of games) {
    await p.query(
      `INSERT INTO games (title, price, description, image, category, platform, publisher, edition, stock_quantity, warehouse_zone, discount_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      game
    );
  }

  console.log('✓ Seeded initial games');
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const p = getPool();
    await p.query('SELECT NOW()');
    console.log('✓ Database connection successful');
    return true;
  } catch (err) {
    console.error('✗ Database connection failed:', err);
    console.error('Hint: check DATABASE_URL, DB_SSL, DB_CONNECT_TIMEOUT_MS, and network access to your DB host.');
    return false;
  }
}
