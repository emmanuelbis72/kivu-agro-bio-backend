ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_title VARCHAR(160);

CREATE TABLE IF NOT EXISTS home_delivery_days (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  delivery_date DATE NOT NULL,
  courier_name VARCHAR(160) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','needs_review','cancelled')),
  split_basis VARCHAR(20) NOT NULL DEFAULT 'sales' CHECK (split_basis IN ('sales','net_result')),
  fees_recipient VARCHAR(20) NOT NULL DEFAULT 'courier' CHECK (fees_recipient IN ('courier','kab','shared')),
  sales JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sales) = 'array'),
  expenses JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(expenses) = 'array'),
  reported JSONB NOT NULL DEFAULT '{}',
  review_reasons JSONB NOT NULL DEFAULT '[]',
  source_evidence JSONB NOT NULL DEFAULT '[]',
  source_key VARCHAR(100) UNIQUE,
  source_file TEXT,
  source_hash VARCHAR(64),
  stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS home_delivery_days_date_idx ON home_delivery_days(delivery_date, customer_id);
