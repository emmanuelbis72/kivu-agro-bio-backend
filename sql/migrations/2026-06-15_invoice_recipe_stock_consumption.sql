ALTER TABLE products
ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(20) NOT NULL DEFAULT 'unit',
ADD COLUMN IF NOT EXISTS pack_size NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS pack_unit VARCHAR(20);

ALTER TABLE warehouse_stock
ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;

ALTER TABLE warehouse_stock
DROP CONSTRAINT IF EXISTS warehouse_stock_quantity_chk;

ALTER TABLE stock_movements
ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);

ALTER TABLE stock_movements
DROP CONSTRAINT IF EXISTS stock_movements_movement_type_chk;

ALTER TABLE stock_transfer_items
ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;

ALTER TABLE purchase_invoice_items
ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);

ALTER TABLE purchase_invoice_items
ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;

ALTER TABLE product_recipes
ADD COLUMN IF NOT EXISTS quantity_unit VARCHAR(20);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_recipes'
      AND column_name = 'unit'
  ) THEN
    EXECUTE '
      UPDATE product_recipes
      SET quantity_unit = COALESCE(quantity_unit, unit)
      WHERE quantity_unit IS NULL
    ';
    EXECUTE 'ALTER TABLE product_recipes ALTER COLUMN unit DROP NOT NULL';
  END IF;
END $$;

ALTER TABLE product_recipes
ALTER COLUMN quantity_required TYPE NUMERIC(18,6)
USING quantity_required::NUMERIC;

ALTER TABLE production_batch_items
ALTER COLUMN quantity_consumed TYPE NUMERIC(18,6)
USING quantity_consumed::NUMERIC;

CREATE TABLE IF NOT EXISTS invoice_stock_consumptions (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE SET NULL,
  sold_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  component_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  consumption_mode VARCHAR(20) NOT NULL,
  sold_quantity NUMERIC(18,6) NOT NULL,
  recipe_quantity NUMERIC(18,6),
  recipe_unit VARCHAR(20),
  consumed_quantity NUMERIC(18,6) NOT NULL,
  consumed_unit VARCHAR(20) NOT NULL,
  stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
  package_size NUMERIC(14,2),
  package_unit VARCHAR(20),
  movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
  reversal_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL,
  reversed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_stock_consumptions_mode_chk
    CHECK (consumption_mode IN ('recipe', 'direct')),
  CONSTRAINT invoice_stock_consumptions_quantity_chk
    CHECK (consumed_quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_stock_consumptions_invoice
ON invoice_stock_consumptions(invoice_id, reversed_at);
