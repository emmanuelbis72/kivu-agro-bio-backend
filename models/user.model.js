import { pool } from "../config/db.js";

export async function countUsers() {
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM users;");
  return Number(result.rows[0]?.count || 0);
}

export async function createUser({
  full_name,
  email,
  password_hash,
  role = "staff",
  is_active = true
}) {
  const result = await pool.query(
    `
      INSERT INTO users (full_name, email, password_hash, role, is_active)
      VALUES ($1, LOWER($2), $3, $4, $5)
      RETURNING id, full_name, email, role, is_active, created_at, updated_at;
    `,
    [full_name, email, password_hash, role, is_active]
  );

  return result.rows[0];
}

export async function getUserByEmail(email) {
  const result = await pool.query(
    `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1;
    `,
    [email]
  );

  return result.rows[0] || null;
}

export async function getUserById(id) {
  const result = await pool.query(
    `
      SELECT id, full_name, email, role, is_active, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );

  return result.rows[0] || null;
}
