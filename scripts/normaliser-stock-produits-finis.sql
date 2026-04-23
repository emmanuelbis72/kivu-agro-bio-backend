BEGIN;

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
WITH kinshasa_warehouse AS (
  SELECT id
  FROM warehouses
  WHERE UPPER(TRIM(name)) = 'KINSHASA'
     OR UPPER(TRIM(city)) = 'KINSHASA'
  ORDER BY id ASC
  LIMIT 1
),
finished_products AS (
  SELECT id AS product_id
  FROM products
  WHERE COALESCE(is_active, TRUE) = TRUE
    AND product_role = 'finished_product'
),
reset_existing AS (
  DELETE FROM warehouse_stock ws
  USING kinshasa_warehouse kw
  WHERE ws.warehouse_id = kw.id
  RETURNING ws.product_id
),
insert_opening_stock AS (
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
  FROM kinshasa_warehouse kw
  CROSS JOIN finished_products fp
  RETURNING warehouse_id, product_id, quantity
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
  ios.product_id,
  ios.warehouse_id,
  'ADJUSTMENT',
  ios.quantity,
  'bulk',
  NULL,
  NULL,
  0,
  'opening_stock',
  NULL,
  'Stock de depart KINSHASA: 100 pieces par produit fini',
  NULL
FROM insert_opening_stock ios
WHERE NOT EXISTS (
  SELECT 1
  FROM stock_movements sm
  WHERE sm.product_id = ios.product_id
    AND sm.warehouse_id = ios.warehouse_id
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
