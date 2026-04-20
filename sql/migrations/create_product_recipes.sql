CREATE TABLE IF NOT EXISTS product_recipes (
  id SERIAL PRIMARY KEY,
  finished_product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_required NUMERIC(14,2) NOT NULL,
  quantity_unit VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT product_recipes_qty_chk CHECK (quantity_required > 0),
  CONSTRAINT product_recipes_quantity_unit_chk CHECK (quantity_unit IN ('g', 'kg', 'ml', 'l', 'unit')),
  CONSTRAINT product_recipes_diff_products_chk CHECK (finished_product_id <> component_product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_recipes_finished_component
ON product_recipes(finished_product_id, component_product_id);

CREATE INDEX IF NOT EXISTS idx_product_recipes_finished_product_id
ON product_recipes(finished_product_id);

CREATE INDEX IF NOT EXISTS idx_product_recipes_component_product_id
ON product_recipes(component_product_id);