import { pool } from "../config/db.js";

export async function createProduct(data) {
  const query = `
    INSERT INTO products (
      name,
      category,
      sku,
      barcode,
      unit,
      stock_unit,
      product_type,
      pack_size,
      pack_unit,
      cost_price,
      selling_price,
      alert_threshold,
      is_active,
      description,
      sales_account_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.unit || "piece",
    data.stock_unit || "unit",
    data.product_type || "finished_product",
    data.pack_size ?? null,
    data.pack_unit || null,
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null,
    data.sales_account_id ?? null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllProducts() {
  const query = `
    SELECT *
    FROM products
    ORDER BY created_at DESC;
  `;
  const result = await pool.query(query);
  return result.rows;
}

export async function getProductById(id) {
  const query = `
    SELECT *
    FROM products
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function getProductBySku(sku) {
  const query = `
    SELECT *
    FROM products
    WHERE sku = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [sku]);
  return result.rows[0] || null;
}

export async function updateProduct(id, data) {
  const query = `
    UPDATE products
    SET
      name = $1,
      category = $2,
      sku = $3,
      barcode = $4,
      unit = $5,
      stock_unit = $6,
      product_type = $7,
      pack_size = $8,
      pack_unit = $9,
      cost_price = $10,
      selling_price = $11,
      alert_threshold = $12,
      is_active = $13,
      description = $14,
      sales_account_id = $15,
      updated_at = NOW()
    WHERE id = $16
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.unit || "piece",
    data.stock_unit || "unit",
    data.product_type || "finished_product",
    data.pack_size ?? null,
    data.pack_unit || null,
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null,
    data.sales_account_id ?? null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteProduct(id) {
  const query = `
    DELETE FROM products
    WHERE id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}