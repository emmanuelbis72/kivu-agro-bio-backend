CREATE TABLE IF NOT EXISTS production_batches (
  id SERIAL PRIMARY KEY,
  batch_number VARCHAR(50) NOT NULL UNIQUE,
  warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  finished_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_produced NUMERIC(14,2) NOT NULL,
  production_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'completed',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT production_batches_qty_chk CHECK (quantity_produced > 0),
  CONSTRAINT production_batches_status_chk CHECK (status IN ('completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_production_batches_warehouse_id
ON production_batches(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_production_batches_finished_product_id
ON production_batches(finished_product_id);