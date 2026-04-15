import { pool } from "../config/db.js";

export async function createWarehouse(data) {
  const query = `
    INSERT INTO warehouses (
      name,
      city,
      address,
      manager_name,
      phone
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;

  const values = [
    data.name,
    data.city,
    data.address || null,
    data.manager_name || null,
    data.phone || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllWarehouses() {
  const query = `
    SELECT *
    FROM warehouses
    ORDER BY created_at DESC;
  `;
  const result = await pool.query(query);
  return result.rows;
}

export async function getWarehouseById(id) {
  const query = `
    SELECT *
    FROM warehouses
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function updateWarehouse(id, data) {
  const query = `
    UPDATE warehouses
    SET
      name = $1,
      city = $2,
      address = $3,
      manager_name = $4,
      phone = $5,
      updated_at = NOW()
    WHERE id = $6
    RETURNING *;
  `;

  const values = [
    data.name,
    data.city,
    data.address || null,
    data.manager_name || null,
    data.phone || null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteWarehouse(id) {
  const query = `
    DELETE FROM warehouses
    WHERE id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}