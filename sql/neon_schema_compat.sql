BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS games
  ADD COLUMN IF NOT EXISTS image TEXT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(60),
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS publisher TEXT,
  ADD COLUMN IF NOT EXISTS edition TEXT,
  ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warehouse_zone TEXT,
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0;

UPDATE games
SET image = COALESCE(image, image_url)
WHERE image IS NULL;

ALTER TABLE IF EXISTS wallets
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS wallet_transactions
  ADD COLUMN IF NOT EXISTS description VARCHAR(255),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS payment_methods
  ADD COLUMN IF NOT EXISTS provider VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_four VARCHAR(4),
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS customer_tier TEXT NOT NULL DEFAULT 'rookie',
  ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE orders
SET subtotal_amount = COALESCE(subtotal_amount, subtotal, 0)
WHERE subtotal_amount IS NULL OR subtotal_amount = 0;

UPDATE orders
SET discount_amount = COALESCE(discount_amount, 0),
    tax_amount = COALESCE(tax_amount, 0),
    total_amount = COALESCE(total_amount, subtotal_amount, subtotal, 0),
    currency_code = COALESCE(currency_code, 'XAF'),
    customer_tier = COALESCE(customer_tier, 'rookie');

ALTER TABLE IF EXISTS order_items
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE order_items
  ALTER COLUMN line_total SET DEFAULT 0;

UPDATE order_items
SET line_total = COALESCE(line_total, unit_price * quantity)
WHERE line_total IS NULL;

ALTER TABLE IF EXISTS payments
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS payment_method_id UUID,
  ADD COLUMN IF NOT EXISTS wallet_transaction_id UUID,
  ADD COLUMN IF NOT EXISTS currency_code CHAR(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE payments
SET currency_code = COALESCE(currency_code, 'XAF')
WHERE currency_code IS NULL;

ALTER TABLE IF EXISTS game_purchases
  ADD COLUMN IF NOT EXISTS order_id UUID;

ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS title VARCHAR(180),
  ADD COLUMN IF NOT EXISTS body TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_status_check'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders DROP CONSTRAINT orders_status_check;
  END IF;
END $$;

ALTER TABLE orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY['draft', 'pending_payment', 'paid', 'fulfilled', 'failed', 'refunded', 'completed']));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_status_check'
      AND conrelid = 'payments'::regclass
  ) THEN
    ALTER TABLE payments DROP CONSTRAINT payments_status_check;
  END IF;
END $$;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
  CHECK (status = ANY (ARRAY['initiated', 'authorized', 'captured', 'failed', 'refunded', 'completed']));

COMMIT;
