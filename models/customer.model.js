import { pool } from "../config/db.js";

export async function createCustomer(data) {
  const query = `
    INSERT INTO customers (
      customer_type,
      business_name,
      contact_name,
      phone,
      email,
      city,
      address,
      payment_terms_days,
      credit_limit,
      notes,
      is_active,
      receivable_account_id,
      warehouse_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *;
  `;

  const values = [
    data.customer_type || "retail",
    data.business_name,
    data.contact_name || null,
    data.phone || null,
    data.email || null,
    data.city || null,
    data.address || null,
    data.payment_terms_days ?? 0,
    data.credit_limit ?? 0,
    data.notes || null,
    data.is_active ?? true,
    data.receivable_account_id || null,
    data.warehouse_id || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllCustomers() {
  const query = `
    SELECT
      c.*,
      a.account_number AS receivable_account_number,
      a.account_name AS receivable_account_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM customers c
    LEFT JOIN accounts a ON a.id = c.receivable_account_id
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    ORDER BY c.created_at DESC;
  `;
  const result = await pool.query(query);
  return result.rows;
}

export async function getCustomerById(id) {
  const query = `
    SELECT
      c.*,
      a.account_number AS receivable_account_number,
      a.account_name AS receivable_account_name,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM customers c
    LEFT JOIN accounts a ON a.id = c.receivable_account_id
    LEFT JOIN warehouses w ON w.id = c.warehouse_id
    WHERE c.id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function updateCustomer(id, data) {
  const query = `
    UPDATE customers
    SET
      customer_type = $1,
      business_name = $2,
      contact_name = $3,
      phone = $4,
      email = $5,
      city = $6,
      address = $7,
      payment_terms_days = $8,
      credit_limit = $9,
      notes = $10,
      is_active = $11,
      receivable_account_id = $12,
      warehouse_id = $13,
      updated_at = NOW()
    WHERE id = $14
    RETURNING *;
  `;

  const values = [
    data.customer_type || "retail",
    data.business_name,
    data.contact_name || null,
    data.phone || null,
    data.email || null,
    data.city || null,
    data.address || null,
    data.payment_terms_days ?? 0,
    data.credit_limit ?? 0,
    data.notes || null,
    data.is_active ?? true,
    data.receivable_account_id || null,
    data.warehouse_id || null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteCustomer(id) {
  const query = `
    DELETE FROM customers
    WHERE id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}
