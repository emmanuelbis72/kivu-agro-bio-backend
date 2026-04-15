import { pool } from "../config/db.js";

export async function createExpense(data) {
  const query = `
    INSERT INTO expenses (
      expense_date,
      category,
      description,
      amount,
      payment_method,
      supplier,
      reference,
      notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;

  const values = [
    data.expense_date,
    data.category,
    data.description,
    data.amount,
    data.payment_method || "cash",
    data.supplier || null,
    data.reference || null,
    data.notes || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getAllExpenses() {
  const query = `
    SELECT
      id,
      expense_date,
      category,
      description,
      amount,
      payment_method,
      supplier,
      reference,
      notes,
      accounting_status,
      accounting_entry_id,
      accounting_message,
      created_at,
      updated_at
    FROM expenses
    ORDER BY expense_date DESC, created_at DESC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getExpenseById(id) {
  const query = `
    SELECT *
    FROM expenses
    WHERE id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}

export async function updateExpense(id, data) {
  const query = `
    UPDATE expenses
    SET
      expense_date = $1,
      category = $2,
      description = $3,
      amount = $4,
      payment_method = $5,
      supplier = $6,
      reference = $7,
      notes = $8,
      updated_at = NOW()
    WHERE id = $9
    RETURNING *;
  `;

  const values = [
    data.expense_date,
    data.category,
    data.description,
    data.amount,
    data.payment_method || "cash",
    data.supplier || null,
    data.reference || null,
    data.notes || null,
    id
  ];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

export async function deleteExpense(id) {
  const query = `
    DELETE FROM expenses
    WHERE id = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}