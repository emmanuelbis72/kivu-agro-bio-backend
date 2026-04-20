ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_type VARCHAR(30) NOT NULL DEFAULT 'finished_product',
ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS pack_size NUMERIC(14,2) NULL,
ADD COLUMN IF NOT EXISTS pack_unit VARCHAR(20) NULL;

UPDATE products
SET stock_unit = COALESCE(NULLIF(TRIM(unit), ''), 'unit')
WHERE stock_unit IS NULL;

ALTER TABLE products
ALTER COLUMN stock_unit SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_product_type_chk'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_product_type_chk
    CHECK (product_type IN ('raw_material', 'finished_product', 'packaging_material'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_unit_chk'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_unit_chk
    CHECK (stock_unit IN ('g', 'kg', 'ml', 'l', 'unit'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_product_type
ON products(product_type);