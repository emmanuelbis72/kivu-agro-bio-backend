BEGIN;

-- Réparation non destructive du schéma attendu par le backend actuel.
ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL;

ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20);

ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);

ALTER TABLE invoice_items
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

ALTER TABLE warehouse_stock
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk';

ALTER TABLE warehouse_stock
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);

ALTER TABLE warehouse_stock
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk';

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

UPDATE products
SET
  product_role = 'finished_product',
  unit = COALESCE(NULLIF(TRIM(unit), ''), 'piece'),
  updated_at = NOW()
WHERE product_role IS NULL
   OR product_role <> 'finished_product'
   OR unit IS NULL
   OR TRIM(unit) = '';

UPDATE invoice_items
SET
  stock_form = NULL,
  package_size = NULL,
  package_unit = NULL;

UPDATE warehouse_stock
SET
  stock_form = COALESCE(NULLIF(TRIM(stock_form), ''), 'bulk'),
  package_size = CASE WHEN stock_form = 'package' THEN package_size ELSE NULL END,
  package_unit = CASE WHEN stock_form = 'package' THEN package_unit ELSE NULL END,
  updated_at = NOW();

UPDATE stock_movements
SET
  stock_form = COALESCE(NULLIF(TRIM(stock_form), ''), 'bulk'),
  package_size = CASE WHEN stock_form = 'package' THEN package_size ELSE NULL END,
  package_unit = CASE WHEN stock_form = 'package' THEN package_unit ELSE NULL END;

-- Restaure le stock de départ KINSHASA: 100 pièces pour chaque produit actif.
WITH kinshasa_warehouses AS (
  SELECT id
  FROM warehouses
  WHERE UPPER(TRIM(name)) = 'KINSHASA'
     OR UPPER(TRIM(city)) = 'KINSHASA'
     OR UPPER(TRIM(name)) LIKE '%KINSHASA%'
),
finished_products AS (
  SELECT id AS product_id
  FROM products
  WHERE COALESCE(is_active, TRUE) = TRUE
),
updated AS (
  UPDATE warehouse_stock ws
  SET
    quantity = 100,
    stock_form = 'bulk',
    package_size = NULL,
    package_unit = NULL,
    updated_at = NOW()
  FROM kinshasa_warehouses kw, finished_products fp
  WHERE ws.warehouse_id = kw.id
    AND ws.product_id = fp.product_id
  RETURNING ws.warehouse_id, ws.product_id, ws.quantity
),
inserted AS (
  INSERT INTO warehouse_stock (
    warehouse_id,
    product_id,
    quantity,
    stock_form,
    package_size,
    package_unit
  )
  SELECT
    kw.id,
    fp.product_id,
    100,
    'bulk',
    NULL,
    NULL
  FROM kinshasa_warehouses kw
  CROSS JOIN finished_products fp
  WHERE NOT EXISTS (
    SELECT 1
    FROM warehouse_stock ws
    WHERE ws.warehouse_id = kw.id
      AND ws.product_id = fp.product_id
  )
  RETURNING warehouse_id, product_id, quantity
),
opening_stock AS (
  SELECT * FROM updated
  UNION ALL
  SELECT * FROM inserted
)
INSERT INTO stock_movements (
  product_id,
  warehouse_id,
  movement_type,
  quantity,
  stock_form,
  package_size,
  package_unit,
  unit_cost,
  reference_type,
  reference_id,
  notes,
  created_by
)
SELECT
  os.product_id,
  os.warehouse_id,
  'ADJUSTMENT',
  os.quantity,
  'bulk',
  NULL,
  NULL,
  0,
  'schema_repair_opening_stock',
  NULL,
  'Réparation stock de départ KINSHASA: 100 pièces par produit fini',
  NULL
FROM opening_stock os
WHERE NOT EXISTS (
  SELECT 1
  FROM stock_movements sm
  WHERE sm.product_id = os.product_id
    AND sm.warehouse_id = os.warehouse_id
    AND sm.reference_type = 'schema_repair_opening_stock'
);

SELECT
  (SELECT COUNT(*) FROM products) AS products_count,
  (SELECT COUNT(*) FROM customers) AS customers_count,
  (SELECT COUNT(*) FROM warehouse_stock) AS warehouse_stock_count,
  (SELECT COUNT(*) FROM invoices) AS invoices_count;

COMMIT;
