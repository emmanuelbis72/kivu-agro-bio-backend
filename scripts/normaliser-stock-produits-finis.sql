BEGIN;

-- 0) Compatibilite schema: certaines bases ont product_type, d'autres product_role.
ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';

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
SET product_role = COALESCE(NULLIF(TRIM(product_role), ''), 'finished_product')
WHERE product_role IS NULL
   OR TRIM(product_role) = '';

-- 1) Tous les produits présents en stock deviennent des produits finis.
UPDATE products p
SET
  product_role = 'finished_product',
  unit = COALESCE(NULLIF(TRIM(unit), ''), 'piece'),
  updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM warehouse_stock ws
  WHERE ws.product_id = p.id
);

-- Compatibilité avec les anciennes bases qui ont aussi une colonne product_type.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'products'
      AND column_name = 'product_type'
  ) THEN
    UPDATE products p
    SET product_type = 'finished_product'
    WHERE EXISTS (
      SELECT 1
      FROM warehouse_stock ws
      WHERE ws.product_id = p.id
    );
  END IF;
END $$;

-- 2) Les factures ne portent plus de notion vrac/paquet.
-- Une ligne de facture = produit fini vendu en pièces.
UPDATE invoice_items ii
SET
  stock_form = NULL,
  package_size = NULL,
  package_unit = NULL
WHERE EXISTS (
  SELECT 1
  FROM products p
  WHERE p.id = ii.product_id
    AND p.product_role = 'finished_product'
);

-- 3) Stock de départ KINSHASA: 100 pièces par produit fini actif.
-- Note technique: la colonne interne warehouse_stock.stock_form accepte seulement
-- 'bulk' ou 'package'. On garde 'bulk' comme forme interne neutre, mais l'interface
-- affiche maintenant "Produit fini" pour ces produits.

-- 3a) Supprime uniquement les anciennes variantes non neutres de KINSHASA.
-- Les lignes bulk existantes sont conservées pour éviter les doublons sur l'index unique.
DELETE FROM warehouse_stock ws
USING warehouses w
WHERE ws.warehouse_id = w.id
  AND (UPPER(TRIM(w.name)) = 'KINSHASA' OR UPPER(TRIM(w.city)) = 'KINSHASA')
  AND (
    ws.stock_form <> 'bulk'
    OR ws.package_size IS NOT NULL
    OR ws.package_unit IS NOT NULL
  );

-- 3b) Met à 100 les lignes de stock KINSHASA déjà existantes.
UPDATE warehouse_stock ws
SET
  quantity = 100,
  stock_form = 'bulk',
  package_size = NULL,
  package_unit = NULL,
  updated_at = NOW()
FROM warehouses w, products p
WHERE ws.warehouse_id = w.id
  AND ws.product_id = p.id
  AND (UPPER(TRIM(w.name)) = 'KINSHASA' OR UPPER(TRIM(w.city)) = 'KINSHASA')
  AND COALESCE(p.is_active, TRUE) = TRUE
  AND p.product_role = 'finished_product';

-- 3c) Insère à 100 uniquement les produits finis qui n'ont pas encore de ligne KINSHASA.
INSERT INTO warehouse_stock (
  warehouse_id,
  product_id,
  quantity,
  stock_form,
  package_size,
  package_unit
)
SELECT
  w.id,
  p.id,
  100,
  'bulk',
  NULL,
  NULL
FROM warehouses w
CROSS JOIN products p
WHERE (UPPER(TRIM(w.name)) = 'KINSHASA' OR UPPER(TRIM(w.city)) = 'KINSHASA')
  AND COALESCE(p.is_active, TRUE) = TRUE
  AND p.product_role = 'finished_product'
  AND NOT EXISTS (
    SELECT 1
    FROM warehouse_stock ws
    WHERE ws.warehouse_id = w.id
      AND ws.product_id = p.id
  );

WITH opening_stock AS (
  SELECT
    ws.warehouse_id,
    ws.product_id,
    ws.quantity
  FROM warehouse_stock ws
  INNER JOIN warehouses w ON w.id = ws.warehouse_id
  INNER JOIN products p ON p.id = ws.product_id
  WHERE (UPPER(TRIM(w.name)) = 'KINSHASA' OR UPPER(TRIM(w.city)) = 'KINSHASA')
    AND COALESCE(p.is_active, TRUE) = TRUE
    AND p.product_role = 'finished_product'
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
  'opening_stock',
  NULL,
  'Stock de depart KINSHASA: 100 pieces par produit fini',
  NULL
FROM opening_stock os
WHERE NOT EXISTS (
  SELECT 1
  FROM stock_movements sm
  WHERE sm.product_id = os.product_id
    AND sm.warehouse_id = os.warehouse_id
    AND sm.reference_type = 'opening_stock'
    AND sm.notes = 'Stock de depart KINSHASA: 100 pieces par produit fini'
);

-- 4) Contrôle après mise à jour.
SELECT
  w.name AS depot,
  w.city,
  COUNT(ws.id) AS lignes_stock,
  COALESCE(SUM(ws.quantity), 0) AS total_pieces
FROM warehouse_stock ws
INNER JOIN warehouses w ON w.id = ws.warehouse_id
WHERE UPPER(TRIM(w.name)) = 'KINSHASA'
   OR UPPER(TRIM(w.city)) = 'KINSHASA'
GROUP BY w.name, w.city;

COMMIT;
