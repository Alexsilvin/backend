import { Router, Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { getPool } from '../utils/db.js';
import { getSessionUser } from '../middleware/auth.js';

const router = Router();
let commerceSchemaBootstrap: Promise<void> | null = null;

async function getUserId(req: Request, res: Response): Promise<string | null> {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user.id;
}

async function ensureWalletRow(db: { query: PoolClient['query'] }, userId: string): Promise<void> {
  await db.query(
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

async function ensureCommerceSchema(): Promise<void> {
  if (!commerceSchemaBootstrap) {
    const p = getPool();
    commerceSchemaBootstrap = p.query(`
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

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        message TEXT,
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `).then(() => undefined).catch((error) => {
      commerceSchemaBootstrap = null;
      throw error;
    });
  }

  return commerceSchemaBootstrap;
}

router.get('/', async (req: Request, res: Response) => {
  const userId = await getUserId(req, res);
  if (!userId) return;

  try {
    const p = getPool();
    await ensureCommerceSchema();
    await ensureWalletRow(p, userId);
    const result = await p.query(
      `SELECT id, user_id, balance, created_at, updated_at
       FROM wallets
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to fetch wallet:', err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

router.get('/purchases', async (req: Request, res: Response) => {
  const userId = await getUserId(req, res);
  if (!userId) return;

  try {
    const p = getPool();
    await ensureCommerceSchema();
    const result = await p.query(
      `SELECT id, game_id, price_paid, purchased_at
       FROM game_purchases
       WHERE user_id = $1
       ORDER BY purchased_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch purchase history:', err);
    res.status(500).json({ error: 'Failed to fetch purchase history' });
  }
});

router.post('/purchase', async (req: Request, res: Response) => {
  const userId = await getUserId(req, res);
  if (!userId) return;

  const { gameId, price } = req.body ?? {};
  if (!gameId || !price || Number(price) <= 0) {
    res.status(400).json({ error: 'Invalid gameId or price' });
    return;
  }

  const p = getPool();
  await ensureCommerceSchema();
  const client = await p.connect();

  try {
    await client.query('BEGIN');
    await ensureWalletRow(client, userId);

    const gameResult = await client.query<{ id: string; title: string; price: number; stock_quantity: number | null }>(
      `SELECT id, title, price, stock_quantity
       FROM games
       WHERE id = $1
       LIMIT 1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const game = gameResult.rows[0];

    const existingPurchase = await client.query(
      `SELECT id, user_id, game_id, price_paid, purchased_at
       FROM game_purchases
       WHERE user_id = $1 AND game_id = $2
       ORDER BY purchased_at DESC
       LIMIT 1`,
      [userId, gameId]
    );

    if (existingPurchase.rows.length > 0) {
      const walletResult = await client.query(
        `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
        [userId]
      );

      await client.query('COMMIT');
      res.json({
        purchase: existingPurchase.rows[0],
        newBalance: walletResult.rows[0]?.balance ?? 0,
        customerTier: 'owned',
      });
      return;
    }

    if (game.stock_quantity !== null && Number(game.stock_quantity) <= 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'This game is out of stock' });
      return;
    }

    const spendResult = await client.query<{ total_spent: string }>(
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

    const walletResult = await client.query(
      `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (walletResult.rows.length === 0 || Number(walletResult.rows[0].balance) < totalAmount) {
      await client.query('ROLLBACK');
      res.status(402).json({ error: 'Insufficient balance' });
      return;
    }

    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO orders (user_id, customer_tier, subtotal_amount, discount_amount, tax_amount, total_amount, currency_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'XAF', 'completed')
       RETURNING id`,
      [userId, customer.tier, basePrice, discountAmount, taxAmount, totalAmount]
    );

    await client.query(
      `INSERT INTO order_items (order_id, game_id, quantity, unit_price, discount_percent)
       VALUES ($1, $2, 1, $3, $4)`,
      [orderResult.rows[0].id, gameId, basePrice, customer.discountPercent]
    );

    const txResult = await client.query<{ id: string }>(
      `INSERT INTO wallet_transactions (user_id, transaction_type, amount, status, description)
       VALUES ($1, 'purchase', $2, 'completed', $3)
       RETURNING id`,
      [userId, totalAmount, `Grid purchase: ${game.title}`]
    );

    await client.query(
      `UPDATE wallets
       SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [totalAmount, userId]
    );

    await client.query(
      `INSERT INTO payments (order_id, user_id, payment_method_id, wallet_transaction_id, amount, currency_code, status, provider)
       VALUES ($1, $2, NULL, $3, $4, 'XAF', 'completed', 'wallet')`,
      [orderResult.rows[0].id, userId, txResult.rows[0].id, totalAmount]
    );

    const purchaseResult = await client.query(
      `INSERT INTO game_purchases (user_id, game_id, order_id, transaction_id, price_paid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, game_id, price_paid, purchased_at`,
      [userId, gameId, orderResult.rows[0].id, txResult.rows[0].id, totalAmount]
    );

    await client.query(
      `INSERT INTO library (user_id, game_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [userId, gameId]
    );

    if (game.stock_quantity !== null) {
      await client.query(
        `UPDATE games
         SET stock_quantity = GREATEST(stock_quantity - 1, 0)
         WHERE id = $1`,
        [gameId]
      );
    }

    const updatedWallet = await client.query(
      `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      purchase: purchaseResult.rows[0],
      newBalance: updatedWallet.rows[0]?.balance ?? 0,
      customerTier: customer.tier,
      discountAmount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Failed to purchase game:', err);
    const message = err instanceof Error ? err.message : 'Failed to purchase game';
    res.status(500).json({ error: message });
  } finally {
    client.release();
  }
});

export default router;
