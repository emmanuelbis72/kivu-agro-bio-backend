CREATE TABLE IF NOT EXISTS stock_transfers (
  id SERIAL PRIMARY KEY,
  transfer_number VARCHAR(50) NOT NULL UNIQUE,
  source_warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  destination_warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transfers_different_warehouses_chk
    CHECK (source_warehouse_id <> destination_warehouse_id),
  CONSTRAINT stock_transfers_status_chk
    CHECK (status IN ('completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id SERIAL PRIMARY KEY,
  transfer_id INT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,2) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transfer_items_quantity_chk
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_warehouse
  ON stock_transfers(source_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination_warehouse
  ON stock_transfers(destination_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id
  ON stock_transfer_items(transfer_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product_id
  ON stock_transfer_items(product_id);