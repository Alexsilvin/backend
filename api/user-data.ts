import type { IncomingMessage, ServerResponse } from 'http';
import { Pool } from 'pg';
import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'neon-grid-session';
let pool: Pool | null = null;
let schemaBootstrap: Promise<void> | null = null;

function getPool(): Pool | null {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) return null;
    pool = new Pool({ connectionString });
  }
  return pool;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

async function getSessionUser(req: IncomingMessage): Promise<string | null> {
  const p = getPool();
  if (!p) return null;

  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;

    const tokenHash = hashToken(token);
    const result = await p.query(
      `SELECT user_id FROM auth_sessions WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );

    return result.rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function ensureUserDataSchema(p: Pool): Promise<void> {
  if (!schemaBootstrap) {
    schemaBootstrap = (async () => {
      await p.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS library (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_id INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, game_id)
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      `);
    })().catch((error) => {
      schemaBootstrap = null;
      throw error;
    });
  }

  return schemaBootstrap;
}

async function ensureWalletRow(p: Pool, userId: string): Promise<void> {
  await p.query(
    `INSERT INTO wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

function getCustomerTier(totalSpent: number) {
  if (totalSpent >= 150) return { tier: 'legend', discountPercent: 10 };
  if (totalSpent >= 75) return { tier: 'elite', discountPercent: 5 };
  if (totalSpent >= 25) return { tier: 'runner', discountPercent: 2 };
  return { tier: 'rookie', discountPercent: 0 };
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userId = await getSessionUser(req);
  if (!userId) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const p = getPool();
  if (!p) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Database not configured' }));
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  try {
    const url = new URL(req.url || '', 'http://localhost');
    const pathname = url.pathname;
    const method = req.method || 'GET';

    await ensureUserDataSchema(p);

    // Route to appropriate handler based on pathname
    if (pathname.startsWith('/api/messages')) {
      return handleMessages(req, res, pathname, method, url, userId, p);
    }
    if (pathname.startsWith('/api/groups')) {
      return handleGroups(req, res, pathname, method, url, userId, p);
    }
    if (pathname.startsWith('/api/wallet')) {
      return handleWallet(req, res, pathname, method, url, userId, p);
    }
    if (pathname.startsWith('/api/friends')) {
      return handleFriends(req, res, pathname, method, url, userId, p);
    }
    if (pathname.startsWith('/api/notifications')) {
      return handleNotifications(req, res, pathname, method, url, userId, p);
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('User data API error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// ============================================================
// MESSAGES HANDLER
// ============================================================
async function handleMessages(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
  userId: string,
  p: Pool
): Promise<void> {
  // GET /api/messages - list conversations or get specific conversation
  if (method === 'GET' && pathname === '/api/messages') {
    const otherUserId = url.searchParams.get('with');

    if (otherUserId) {
      const result = await p.query(
        `SELECT m.id, m.sender_id, m.recipient_id, m.content, m.is_read, m.created_at,
                s.username as sender_username, r.username as recipient_username
         FROM messages m
         LEFT JOIN users s ON m.sender_id = s.id
         LEFT JOIN users r ON m.recipient_id = r.id
         WHERE (m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1)
         ORDER BY m.created_at DESC
         LIMIT 100`,
        [userId, otherUserId]
      );
      res.statusCode = 200;
      res.end(JSON.stringify(result.rows.reverse()));
    } else {
      const result = await p.query(
        `WITH latest_messages AS (
           SELECT 
             CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END as other_user_id,
             MAX(created_at) as latest_at
           FROM messages
           WHERE sender_id = $1 OR recipient_id = $1
           GROUP BY other_user_id
         )
         SELECT 
           lm.other_user_id,
           u.username,
           u.avatar,
           m.content as last_message,
           m.created_at as last_message_at,
           COUNT(CASE WHEN m.recipient_id = $1 AND m.is_read = FALSE THEN 1 END) as unread_count
         FROM latest_messages lm
         JOIN users u ON u.id = lm.other_user_id
         JOIN messages m ON 
           ((m.sender_id = $1 AND m.recipient_id = lm.other_user_id) OR
            (m.sender_id = lm.other_user_id AND m.recipient_id = $1))
           AND m.created_at = lm.latest_at
         GROUP BY lm.other_user_id, u.username, u.avatar, m.content, m.created_at
         ORDER BY m.created_at DESC`,
        [userId]
      );
      res.statusCode = 200;
      res.end(JSON.stringify(result.rows));
    }
    return;
  }

  // POST /api/messages - send message
  if (method === 'POST' && pathname === '/api/messages') {
    const body = JSON.parse(await readBody(req));
    const { recipientId, content } = body;

    if (!recipientId || !content) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing recipientId or content' }));
      return;
    }

    const result = await p.query(
      `INSERT INTO messages (sender_id, recipient_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, recipient_id, content, is_read, created_at`,
      [userId, recipientId, content]
    );

    res.statusCode = 201;
    res.end(JSON.stringify(result.rows[0]));
    return;
  }

  // PATCH /api/messages - mark messages as read
  if (method === 'PATCH' && pathname === '/api/messages') {
    const body = JSON.parse(await readBody(req));
    const { senderId } = body;

    if (!senderId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Missing senderId' }));
      return;
    }

    await p.query(
      `UPDATE messages SET is_read = TRUE, read_at = NOW()
       WHERE recipient_id = $1 AND sender_id = $2`,
      [userId, senderId]
    );

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ============================================================
// GROUPS HANDLER
// ============================================================
async function handleGroups(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
  userId: string,
  p: Pool
): Promise<void> {
  // GET /api/groups - list groups user is member of
  if (method === 'GET' && pathname === '/api/groups') {
    const result = await p.query(
      `SELECT mg.id, mg.name, mg.description, mg.is_public, mg.creator_id,
              COUNT(gm.id) as member_count,
              u.username as creator_username
       FROM message_groups mg
       JOIN group_members gm ON mg.id = gm.group_id
       JOIN users u ON mg.creator_id = u.id
       WHERE gm.user_id = $1
       GROUP BY mg.id, u.username
       ORDER BY mg.updated_at DESC`,
      [userId]
    );

    res.statusCode = 200;
    res.end(JSON.stringify(result.rows));
    return;
  }

  // POST /api/groups - create new group
  if (method === 'POST' && pathname === '/api/groups') {
    const body = JSON.parse(await readBody(req));
    const { name, description, isPublic } = body;

    if (!name) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Group name required' }));
      return;
    }

    await p.query('BEGIN');
    try {
      const groupResult = await p.query(
        `INSERT INTO message_groups (name, description, creator_id, is_public)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, description, is_public, creator_id, created_at`,
        [name, description || null, userId, isPublic !== false]
      );

      const groupId = groupResult.rows[0].id;

      await p.query(
        `INSERT INTO group_members (group_id, user_id, is_admin)
         VALUES ($1, $2, TRUE)`,
        [groupId, userId]
      );

      await p.query('COMMIT');
      res.statusCode = 201;
      res.end(JSON.stringify(groupResult.rows[0]));
    } catch (error) {
      await p.query('ROLLBACK');
      throw error;
    }
    return;
  }

  // GET /api/groups/[id]/messages - get group messages
  const groupMessagesMatch = pathname.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (method === 'GET' && groupMessagesMatch) {
    const groupId = groupMessagesMatch[1];

    const memberCheck = await p.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Not a member of this group' }));
      return;
    }

    const result = await p.query(
      `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.created_at,
              u.username as sender_username
       FROM group_messages gm
       JOIN users u ON gm.sender_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.created_at DESC
       LIMIT 100`,
      [groupId]
    );

    res.statusCode = 200;
    res.end(JSON.stringify(result.rows.reverse()));
    return;
  }

  // POST /api/groups/[id]/messages - send group message
  const postGroupMessageMatch = pathname.match(/^\/api\/groups\/([^/]+)\/messages$/);
  if (method === 'POST' && postGroupMessageMatch) {
    const groupId = postGroupMessageMatch[1];
    const body = JSON.parse(await readBody(req));
    const { content } = body;

    if (!content) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Message content required' }));
      return;
    }

    const memberCheck = await p.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Not a member of this group' }));
      return;
    }

    const result = await p.query(
      `INSERT INTO group_messages (group_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, group_id, sender_id, content, created_at`,
      [groupId, userId, content]
    );

    await p.query(
      `UPDATE message_groups SET updated_at = NOW() WHERE id = $1`,
      [groupId]
    );

    res.statusCode = 201;
    res.end(JSON.stringify(result.rows[0]));
    return;
  }

  // POST /api/groups/[id]/members - add member to group
  const addMemberMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members$/);
  if (method === 'POST' && addMemberMatch) {
    const groupId = addMemberMatch[1];
    const body = JSON.parse(await readBody(req));
    const { userId: targetUserId } = body;

    if (!targetUserId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'User ID required' }));
      return;
    }

    const adminCheck = await p.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND is_admin = TRUE`,
      [groupId, userId]
    );

    if (adminCheck.rows.length === 0) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Only admins can add members' }));
      return;
    }

    try {
      await p.query(
        `INSERT INTO group_members (group_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [groupId, targetUserId]
      );

      res.statusCode = 201;
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Failed to add member' }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ============================================================
// WALLET HANDLER
// ============================================================
async function handleWallet(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
  userId: string,
  p: Pool
): Promise<void> {
  // GET /api/wallet - get wallet balance
  if (method === 'GET' && pathname === '/api/wallet') {
    await ensureWalletRow(p, userId);
    const result = await p.query(
      `SELECT id, user_id, balance, created_at, updated_at FROM wallets WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Wallet not found' }));
      return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify(result.rows[0]));
    return;
  }

  // POST /api/wallet/topup - add funds to wallet
  if (method === 'POST' && pathname === '/api/wallet/topup') {
    const body = JSON.parse(await readBody(req));
    const { amount, paymentMethodId, description } = body;

    if (!amount || amount <= 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid amount' }));
      return;
    }

    await p.query('BEGIN');
    try {
      await ensureWalletRow(p, userId);

      const txResult = await p.query(
        `INSERT INTO wallet_transactions 
         (user_id, payment_method_id, transaction_type, amount, status, description)
         VALUES ($1, $2, 'topup', $3, 'completed', $4)
         RETURNING id, amount, status, created_at`,
        [userId, paymentMethodId || null, amount, description || `Wallet topup: $${amount}`]
      );

      await p.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2`,
        [amount, userId]
      );

      const walletResult = await p.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [userId]
      );

      await p.query('COMMIT');

      res.statusCode = 201;
      res.end(JSON.stringify({
        transaction: txResult.rows[0],
        newBalance: walletResult.rows[0].balance,
      }));
    } catch (error) {
      await p.query('ROLLBACK');
      throw error;
    }
    return;
  }

  // GET /api/wallet/transactions - get transaction history
  if (method === 'GET' && pathname === '/api/wallet/transactions') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const result = await p.query(
      `SELECT id, transaction_type, amount, status, description, created_at
       FROM wallet_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.statusCode = 200;
    res.end(JSON.stringify(result.rows));
    return;
  }

  // POST /api/wallet/purchase - purchase a game
  if (method === 'POST' && pathname === '/api/wallet/purchase') {
    const body = JSON.parse(await readBody(req));
    const { gameId, price } = body;

    if (!gameId || !price || price <= 0) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid gameId or price' }));
      return;
    }

    await p.query('BEGIN');
    try {
      const gameResult = await p.query<{ id: string; title: string; price: number; stock_quantity: number | null }>(
        `SELECT id, title, price, stock_quantity
         FROM games
         WHERE id = $1
         LIMIT 1`,
        [gameId]
      );

      if (gameResult.rows.length === 0) {
        await p.query('ROLLBACK');
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Game not found' }));
        return;
      }

      const game = gameResult.rows[0];
      const existingPurchase = await p.query(
        `SELECT 1 FROM game_purchases WHERE user_id = $1 AND game_id = $2 LIMIT 1`,
        [userId, gameId]
      );

      if (existingPurchase.rows.length > 0) {
        const purchaseResult = await p.query(
          `SELECT id, user_id, game_id, price_paid, purchased_at
           FROM game_purchases
           WHERE user_id = $1 AND game_id = $2
           ORDER BY purchased_at DESC
           LIMIT 1`,
          [userId, gameId]
        );

        const walletResult = await p.query(
          `SELECT balance FROM wallets WHERE user_id = $1`,
          [userId]
        );

        await p.query('COMMIT');
        res.statusCode = 200;
        res.end(JSON.stringify({
          purchase: purchaseResult.rows[0],
          newBalance: walletResult.rows[0].balance,
          customerTier: 'owned',
        }));
        return;
      }

      if (game.stock_quantity !== null && Number(game.stock_quantity) <= 0) {
        await p.query('ROLLBACK');
        res.statusCode = 409;
        res.end(JSON.stringify({ error: 'This game is out of stock' }));
        return;
      }

      const spendResult = await p.query<{ total_spent: string }>(
        `SELECT COALESCE(SUM(price_paid), 0)::text AS total_spent
         FROM game_purchases
         WHERE user_id = $1`,
        [userId]
      );
      const spentBeforePurchase = Number(spendResult.rows[0]?.total_spent ?? 0);
      const customer = getCustomerTier(spentBeforePurchase);
      const basePrice = Number(game.price ?? price);
      const discountAmount = Number((basePrice * (customer.discountPercent / 100)).toFixed(2));
      const taxAmount = 0;
      const totalAmount = Number((basePrice - discountAmount + taxAmount).toFixed(2));

      const walletResult = await p.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [userId]
      );

      if (walletResult.rows.length === 0 || Number(walletResult.rows[0].balance) < totalAmount) {
        await p.query('ROLLBACK');
        res.statusCode = 402;
        res.end(JSON.stringify({ error: 'Insufficient balance' }));
        return;
      }

      const orderResult = await p.query<{ id: string }>(
        `INSERT INTO orders (user_id, customer_tier, subtotal_amount, discount_amount, tax_amount, total_amount, currency_code, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'XAF', 'completed')
         RETURNING id`,
        [userId, customer.tier, basePrice, discountAmount, taxAmount, totalAmount]
      );

      await p.query(
        `INSERT INTO order_items (order_id, game_id, quantity, unit_price, discount_percent)
         VALUES ($1, $2, 1, $3, $4)`,
        [orderResult.rows[0].id, gameId, basePrice, customer.discountPercent]
      );

      const txResult = await p.query(
        `INSERT INTO wallet_transactions 
         (user_id, transaction_type, amount, status, description)
         VALUES ($1, 'purchase', $2, 'completed', $3)
         RETURNING id`,
        [userId, totalAmount, `Grid purchase: ${game.title}`]
      );

      const transactionId = txResult.rows[0].id;

      await p.query(
        `UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2`,
        [totalAmount, userId]
      );

      await p.query(
        `INSERT INTO payments (order_id, user_id, payment_method_id, wallet_transaction_id, amount, currency_code, status, provider)
         VALUES ($1, $2, NULL, $3, $4, 'XAF', 'completed', 'wallet')`,
        [orderResult.rows[0].id, userId, transactionId, totalAmount]
      );

      const purchaseResult = await p.query(
        `INSERT INTO game_purchases (user_id, game_id, order_id, transaction_id, price_paid)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, purchased_at`,
        [userId, gameId, orderResult.rows[0].id, transactionId, totalAmount]
      );

      await p.query(
        `INSERT INTO library (user_id, game_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, game_id) DO NOTHING`,
        [userId, gameId]
      );

      if (game.stock_quantity !== null) {
        await p.query(
          `UPDATE games SET stock_quantity = GREATEST(stock_quantity - 1, 0) WHERE id = $1`,
          [gameId]
        );
      }

      const updatedWallet = await p.query(
        `SELECT balance FROM wallets WHERE user_id = $1`,
        [userId]
      );

      const orderRow = await p.query(
        `SELECT id, customer_tier, subtotal_amount, discount_amount, tax_amount, total_amount, currency_code, status, created_at
         FROM orders
         WHERE id = $1
         LIMIT 1`,
        [orderResult.rows[0].id]
      );

      await p.query('COMMIT');

      res.statusCode = 201;
      res.end(JSON.stringify({
        purchase: purchaseResult.rows[0],
        newBalance: updatedWallet.rows[0].balance,
        order: orderRow.rows[0],
        customerTier: customer.tier,
        discountAmount,
      }));
    } catch (error) {
      await p.query('ROLLBACK');
      throw error;
    }
    return;
  }

  // GET /api/wallet/purchases - get purchase history
  if (method === 'GET' && pathname === '/api/wallet/purchases') {
    const result = await p.query(
      `SELECT id, game_id, price_paid, purchased_at FROM game_purchases
       WHERE user_id = $1 ORDER BY purchased_at DESC LIMIT 100`,
      [userId]
    );

    res.statusCode = 200;
    res.end(JSON.stringify(result.rows));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}

// ============================================================
// FRIENDS HANDLER
// ============================================================
async function handleFriends(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
  userId: string,
  p: Pool
): Promise<void> {
  if (method === 'GET') {
    const searchTerm = url.searchParams.get('search')?.trim() || '';

    if (searchTerm) {
      const result = await p.query(
        `SELECT u.id, u.username, u.avatar_url, COALESCE(u.role, 'player')::text AS role, u.email,
                EXISTS(SELECT 1 FROM friends f WHERE f.user_id = $1 AND f.friend_id = u.id AND f.status = 'accepted') AS is_friend
         FROM users u WHERE u.id <> $1 AND (u.username ILIKE $2 || '%' OR u.username ILIKE '%' || $2 || '%')
         ORDER BY CASE WHEN u.username ILIKE $2 || '%' THEN 0 ELSE 1 END, u.username ASC LIMIT 8`,
        [userId, searchTerm.slice(0, 40)]
      );
      res.statusCode = 200;
      res.end(JSON.stringify({ users: result.rows }));
      return;
    }

    const result = await p.query(
      `SELECT f.id, u.username,
              CASE WHEN EXISTS(SELECT 1 FROM auth_sessions s2 WHERE s2.user_id = u.id AND s2.expires_at > NOW()) THEN 'online' ELSE 'offline' END::text AS status
       FROM friends f INNER JOIN users u ON u.id = f.friend_id WHERE f.user_id = $1 AND f.status = 'accepted' ORDER BY u.username ASC`,
      [userId]
    );
    res.statusCode = 200;
    res.end(JSON.stringify({ friends: result.rows }));
    return;
  }

  if (method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const { username: targetUsername } = body;

    if (!targetUsername || typeof targetUsername !== 'string') {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'username is required' }));
      return;
    }

    const target = await p.query(`SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`, [targetUsername.trim()]);

    if (target.rows.length === 0) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'User not found' }));
      return;
    }

    const friend = target.rows[0];

    try {
      await p.query('BEGIN');
      await p.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = EXCLUDED.status`,
        [userId, friend.id]
      );
      await p.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_id, friend_id) DO UPDATE SET status = EXCLUDED.status`,
        [friend.id, userId]
      );
      await p.query(
        `INSERT INTO notifications (user_id, type, actor_id, message, is_read) VALUES ($1, 'friend', $2, $3, false)`,
        [friend.id, userId, `${(await p.query('SELECT username FROM users WHERE id = $1', [userId])).rows[0]?.username} added you to GRID_CONTACTS.`]
      );
      await p.query('COMMIT');
      res.statusCode = 201;
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      await p.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

// ============================================================
// NOTIFICATIONS HANDLER
// ============================================================
async function handleNotifications(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  url: URL,
  userId: string,
  p: Pool
): Promise<void> {
  if (method === 'PATCH') {
    const action = (url.searchParams.get('action') || '').toLowerCase();
    if (action === 'mark-all-read') {
      await p.query(`UPDATE notifications SET is_read = true WHERE user_id = $1`, [userId]);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Unsupported notification action' }));
    return;
  }

  if (method === 'DELETE') {
    const id = (url.searchParams.get('id') || '').trim();
    if (id) {
      await p.query(`DELETE FROM notifications WHERE user_id = $1 AND id = $2`, [userId, id]);
    } else {
      await p.query(`DELETE FROM notifications WHERE user_id = $1`, [userId]);
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (method === 'GET') {
    const result = await p.query(
      `SELECT n.id, n.type, n.message, n.is_read, n.created_at, actor.username as actor_username
       FROM notifications n LEFT JOIN users actor ON actor.id = n.actor_id
       WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
      [userId]
    );
    const notifications = result.rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      title: row.actor_username ? `${row.actor_username.toUpperCase()} // ${row.type.toUpperCase()}` : row.type.toUpperCase(),
      message: row.message ?? 'New activity in your account.',
      time: row.created_at,
      read: row.is_read,
    }));
    res.statusCode = 200;
    res.end(JSON.stringify({ notifications }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
