import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";

function getExecutor(client) {
  return client || pool;
}

async function ensureProductsSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';
  `);
  await executor.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS archive_reason TEXT;
  `);
}

function isProductsPrimaryKeyConflict(error) {
  return (
    error?.code === "23505" &&
    String(error?.constraint || "").trim() === "products_pkey"
  );
}

async function syncProductsIdSequence(executor = pool) {
  const sequenceResult = await executor.query(`
    SELECT pg_get_serial_sequence('products', 'id') AS sequence_name;
  `);

  const sequenceName = sequenceResult.rows[0]?.sequence_name || null;

  if (!sequenceName) {
    return;
  }

  await executor.query(
    `
      SELECT setval(
        $1,
        GREATEST((SELECT COALESCE(MAX(id), 0) FROM products), 1),
        EXISTS (SELECT 1 FROM products)
      );
    `,
    [sequenceName]
  );
}

export async function createProduct(data) {
  const executor = getExecutor(data.client);
  const query = `
    INSERT INTO products (
      name,
      category,
      sku,
      barcode,
      product_role,
      unit,
      cost_price,
      selling_price,
      alert_threshold,
      is_active,
      description,
      sales_account_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.product_role || "finished_product",
    data.unit || "piece",
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null,
    data.sales_account_id ?? null
  ];

  await ensureProductsSchema(executor);
  await syncProductsIdSequence(executor);

  try {
    const result = await executor.query(query, values);
    return result.rows[0];
  } catch (error) {
    if (!isProductsPrimaryKeyConflict(error)) {
      throw error;
    }

    await syncProductsIdSequence(executor);
    const retryResult = await executor.query(query, values);
    return retryResult.rows[0];
  }
}

export async function getAllProducts() {
  const query = `
    SELECT *
    FROM products
    WHERE archived_at IS NULL
    ORDER BY created_at DESC;
  `;
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureProductsSchema(pool),
    query
  });
  return result.rows;
}

export async function getProductById(id) {
  const query = `
    SELECT *
    FROM products
    WHERE id = $1
      AND archived_at IS NULL
    LIMIT 1;
  `;
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureProductsSchema(pool),
    query,
    values: [id]
  });
  return result.rows[0] || null;
}

export async function getProductBySku(sku) {
  const query = `
    SELECT *
    FROM products
    WHERE sku = $1
      AND archived_at IS NULL
    LIMIT 1;
  `;
  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureProductsSchema(pool),
    query,
    values: [sku]
  });
  return result.rows[0] || null;
}

export async function updateProduct(id, data) {
  const executor = getExecutor(data.client);
  const query = `
    UPDATE products
    SET
      name = $1,
      category = $2,
      sku = $3,
      barcode = $4,
      product_role = $5,
      unit = $6,
      cost_price = $7,
      selling_price = $8,
      alert_threshold = $9,
      is_active = $10,
      description = $11,
      sales_account_id = $12,
      updated_at = NOW()
    WHERE id = $13
      AND archived_at IS NULL
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.product_role || "finished_product",
    data.unit || "piece",
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null,
    data.sales_account_id ?? null,
    id
  ];

  await ensureProductsSchema(executor);
  const result = await executor.query(query, values);
  return result.rows[0] || null;
}

export async function deleteProduct(id, { archived_by = null, reason = null } = {}) {
  await ensureProductsSchema(pool);
  const query = `
    UPDATE products
    SET
      is_active = FALSE,
      archived_at = NOW(),
      archived_by = $2,
      archive_reason = $3,
      updated_at = NOW()
    WHERE id = $1
      AND archived_at IS NULL
    RETURNING *;
  `;
  const result = await pool.query(query, [id, archived_by, reason]);
  return result.rows[0] || null;
}
