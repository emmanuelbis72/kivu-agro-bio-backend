ALTER TABLE warehouse_stock
ALTER COLUMN quantity TYPE NUMERIC(14,2) USING quantity::NUMERIC;

ALTER TABLE warehouse_stock
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_warehouse_product'
  ) THEN
    ALTER TABLE warehouse_stock
    DROP CONSTRAINT unique_warehouse_product;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouse_stock_quantity_chk'
  ) THEN
    ALTER TABLE warehouse_stock
    ADD CONSTRAINT warehouse_stock_quantity_chk CHECK (quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouse_stock_stock_form_chk'
  ) THEN
    ALTER TABLE warehouse_stock
    ADD CONSTRAINT warehouse_stock_stock_form_chk
    CHECK (stock_form IN ('bulk', 'package'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouse_stock_package_chk'
  ) THEN
    ALTER TABLE warehouse_stock
    ADD CONSTRAINT warehouse_stock_package_chk CHECK (
      (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
      OR
      (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_stock_variant
ON warehouse_stock (
  warehouse_id,
  product_id,
  stock_form,
  COALESCE(package_size, 0),
  COALESCE(package_unit, '')
);

ALTER TABLE stock_movements
ALTER COLUMN quantity TYPE NUMERIC(14,2) USING quantity::NUMERIC;

ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_movement_type'
  ) THEN
    ALTER TABLE stock_movements
    DROP CONSTRAINT chk_movement_type;
  END IF;

  ALTER TABLE stock_movements
  ADD CONSTRAINT chk_movement_type CHECK (
    movement_type IN (
      'IN',
      'OUT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'ADJUSTMENT',
      'PRODUCTION_CONSUME',
      'PRODUCTION_OUTPUT',
      'TRANSFORM_IN',
      'TRANSFORM_OUT',
      'MIXTURE_IN',
      'MIXTURE_OUT'
    )
  );
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_quantity_chk'
  ) THEN
    ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_quantity_chk CHECK (quantity > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_stock_form_chk'
  ) THEN
    ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_stock_form_chk
    CHECK (stock_form IN ('bulk', 'package'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_package_chk'
  ) THEN
    ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_package_chk CHECK (
      (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
      OR
      (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
    );
  END IF;
END $$;

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
  stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
  package_size NUMERIC(14,2),
  package_unit VARCHAR(20),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transfer_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT stock_transfer_items_stock_form_chk CHECK (stock_form IN ('bulk', 'package')),
  CONSTRAINT stock_transfer_items_package_chk CHECK (
    (stock_form = 'bulk' AND package_size IS NULL AND package_unit IS NULL)
    OR
    (stock_form = 'package' AND package_size > 0 AND package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
  )
);

ALTER TABLE stock_transfer_items
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2),
ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);

ALTER TABLE stock_transfer_items
ALTER COLUMN quantity TYPE NUMERIC(14,2) USING quantity::NUMERIC;

CREATE TABLE IF NOT EXISTS stock_transformations (
  id SERIAL PRIMARY KEY,
  warehouse_id INT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  transformation_type VARCHAR(30) NOT NULL,
  target_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  target_quantity NUMERIC(14,2) NOT NULL,
  target_stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
  target_package_size NUMERIC(14,2),
  target_package_unit VARCHAR(20),
  notes TEXT NULL,
  created_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transformations_type_chk CHECK (transformation_type IN ('bulk_to_package', 'bulk_mix')),
  CONSTRAINT stock_transformations_quantity_chk CHECK (target_quantity > 0),
  CONSTRAINT stock_transformations_stock_form_chk CHECK (target_stock_form IN ('bulk', 'package')),
  CONSTRAINT stock_transformations_package_chk CHECK (
    (target_stock_form = 'bulk' AND target_package_size IS NULL AND target_package_unit IS NULL)
    OR
    (target_stock_form = 'package' AND target_package_size > 0 AND target_package_unit IN ('g', 'kg', 'ml', 'l', 'unit', 'piece'))
  )
);

CREATE TABLE IF NOT EXISTS stock_transformation_inputs (
  id SERIAL PRIMARY KEY,
  transformation_id INT NOT NULL REFERENCES stock_transformations(id) ON DELETE CASCADE,
  source_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  source_quantity NUMERIC(14,2) NOT NULL,
  source_stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transformation_inputs_quantity_chk CHECK (source_quantity > 0),
  CONSTRAINT stock_transformation_inputs_stock_form_chk CHECK (source_stock_form = 'bulk')
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse_id
ON warehouse_stock(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product_id
ON warehouse_stock(product_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_warehouse
ON stock_transfers(source_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination_warehouse
ON stock_transfers(destination_warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer_id
ON stock_transfer_items(transfer_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_product_id
ON stock_transfer_items(product_id);

CREATE INDEX IF NOT EXISTS idx_stock_transformations_warehouse_id
ON stock_transformations(warehouse_id);

CREATE INDEX IF NOT EXISTS idx_stock_transformations_target_product_id
ON stock_transformations(target_product_id);

CREATE INDEX IF NOT EXISTS idx_stock_transformation_inputs_transformation_id
ON stock_transformation_inputs(transformation_id);

CREATE INDEX IF NOT EXISTS idx_stock_transformation_inputs_product_id
ON stock_transformation_inputs(source_product_id);
