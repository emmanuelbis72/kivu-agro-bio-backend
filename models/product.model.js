import { pool } from "../config/db.js";

export async function createProduct(data) {
  const query = `
    INSERT INTO products (
      name,
      category,
      sku,
      barcode,
      unit,
      cost_price,
      selling_price,
      alert_threshold,
      is_active,
      description
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.unit || "piece",
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null
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
      cost_price = $6,
      selling_price = $7,
      alert_threshold = $8,
      is_active = $9,
      description = $10,
      updated_at = NOW()
    WHERE id = $11
    RETURNING *;
  `;

  const values = [
    data.name,
    data.category || null,
    data.sku,
    data.barcode || null,
    data.unit || "piece",
    data.cost_price ?? 0,
    data.selling_price ?? 0,
    data.alert_threshold ?? 0,
    data.is_active ?? true,
    data.description || null,
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