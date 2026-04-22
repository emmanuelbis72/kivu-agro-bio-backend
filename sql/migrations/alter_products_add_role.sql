ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_role VARCHAR(30);

UPDATE products
SET product_role = CASE
  WHEN COALESCE(selling_price, 0) > 0 THEN 'finished_product'
  ELSE 'raw_material'
END
WHERE product_role IS NULL;

ALTER TABLE products
ALTER COLUMN product_role SET DEFAULT 'finished_product';

ALTER TABLE products
ALTER COLUMN product_role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_role_chk'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_role_chk
    CHECK (
      product_role IN (
        'finished_product',
        'raw_material',
        'packaging_material'
      )
    );
  END IF;
END $$;
