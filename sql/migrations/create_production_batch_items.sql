CREATE TABLE IF NOT EXISTS production_batch_items (
  id SERIAL PRIMARY KEY,
  batch_id INT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  component_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_consumed NUMERIC(14,2) NOT NULL,
  quantity_unit VARCHAR(20) NOT NULL,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT production_batch_items_qty_chk CHECK (quantity_consumed > 0),
  CONSTRAINT production_batch_items_quantity_unit_chk CHECK (quantity_unit IN ('g', 'kg', 'ml', 'l', 'unit'))
);

CREATE INDEX IF NOT EXISTS idx_production_batch_items_batch_id
ON production_batch_items(batch_id);

CREATE INDEX IF NOT EXISTS idx_production_batch_items_component_product_id
ON production_batch_items(component_product_id);