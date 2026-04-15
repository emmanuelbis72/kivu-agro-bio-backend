import { pool } from "../config/db.js";

export async function createAccount(data) {
  const query = `
    INSERT INTO accounts (
      account_number,
      account_name,
      account_class,
      account_type,
      parent_account_id,
      is_postable,
      is_active,
      ohada_category
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  const values = [
    data.account_number,
    data.account_name,
    data.account_class,
    data.account_type,
    data.parent_account_id || null,
    data.is_postable,
    data.is_active,
    data.ohada_category || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllAccounts() {
  const query = `
    SELECT
      a.*,
      p.account_number AS parent_account_number,
      p.account_name AS parent_account_name
    FROM accounts a
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    ORDER BY a.account_number ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getAccountById(id) {
  const query = `
    SELECT
      a.*,
      p.account_number AS parent_account_number,
      p.account_name AS parent_account_name
    FROM accounts a
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE a.id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function getAccountByNumber(accountNumber) {
  const query = `
    SELECT
      a.*,
      p.account_number AS parent_account_number,
      p.account_name AS parent_account_name
    FROM accounts a
    LEFT JOIN accounts p ON p.id = a.parent_account_id
    WHERE a.account_number = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [accountNumber]);
  return result.rows[0] || null;
}

export async function updateAccount(id, data) {
  const query = `
    UPDATE accounts
    SET
      account_number = $1,
      account_name = $2,
      account_class = $3,
      account_type = $4,
      parent_account_id = $5,
      is_postable = $6,
      is_active = $7,
      ohada_category = $8,
      updated_at = NOW()
    WHERE id = $9
    RETURNING *;
  `;

  const values = [
    data.account_number,
    data.account_name,
    data.account_class,
    data.account_type,
    data.parent_account_id || null,
    data.is_postable,
    data.is_active,
    data.ohada_category || null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteAccount(id) {
  const query = `
    DELETE FROM accounts
    WHERE id = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}