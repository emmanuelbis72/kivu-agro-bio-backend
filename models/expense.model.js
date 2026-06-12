import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";
import { ensureSuppliersSchema } from "./supplier.model.js";

async function ensureExpensesArchiveSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS archive_reason TEXT;
  `);
}

export async function createExpense(data) {
  await ensureSuppliersSchema(pool);
  await ensureExpensesArchiveSchema(pool);
  const query = `
    INSERT INTO expenses (
      expense_date,
      category,
      description,
      amount,
      payment_method,
      supplier_id,
      supplier,
      reference,
      notes,
      created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *;
  `;

  const values = [
    data.expense_date,
    data.category,
    data.description,
    data.amount,
    data.payment_method || "cash",
    data.supplier_id || null,
    data.supplier || null,
    data.reference || null,
    data.notes || null,
    data.created_by || null
  ];

  const result = await pool.query(query, values);
  return getExpenseById(result.rows[0].id);
}

export async function getAllExpenses() {
  await ensureExpensesArchiveSchema(pool);
  const query = `
    SELECT
      e.id,
      e.expense_date,
      e.category,
      e.description,
      e.amount,
      e.payment_method,
      e.supplier_id,
      e.supplier,
      s.business_name AS supplier_business_name,
      s.payable_account_id AS supplier_payable_account_id,
      s.is_active AS supplier_is_active,
      e.reference,
      e.notes,
      e.accounting_status,
      e.accounting_entry_id,
      e.accounting_message,
      e.created_at,
      e.updated_at
    FROM expenses e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    WHERE e.archived_at IS NULL
    ORDER BY e.expense_date DESC, e.created_at DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureSuppliersSchema(pool),
    query
  });

  return result.rows;
}

export async function getExpenseById(id) {
  await ensureExpensesArchiveSchema(pool);
  const query = `
    SELECT
      e.*,
      s.business_name AS supplier_business_name,
      s.payable_account_id AS supplier_payable_account_id,
      s.is_active AS supplier_is_active
    FROM expenses e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    WHERE e.id = $1
      AND e.archived_at IS NULL
    LIMIT 1;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureSuppliersSchema(pool),
    query,
    values: [id]
  });

  return result.rows[0] || null;
}

export async function updateExpense(id, data) {
  await ensureSuppliersSchema(pool);
  await ensureExpensesArchiveSchema(pool);
  const query = `
    UPDATE expenses
    SET
      expense_date = $1,
      category = $2,
      description = $3,
      amount = $4,
      payment_method = $5,
      supplier_id = $6,
      supplier = $7,
      reference = $8,
      notes = $9,
      updated_at = NOW()
    WHERE id = $10
      AND archived_at IS NULL
    RETURNING *;
  `;

  const values = [
    data.expense_date,
    data.category,
    data.description,
    data.amount,
    data.payment_method || "cash",
    data.supplier_id || null,
    data.supplier || null,
    data.reference || null,
    data.notes || null,
    id
  ];

  const result = await pool.query(query, values);

  if (!result.rows[0]) {
    return null;
  }

  return getExpenseById(id);
}

export async function deleteExpense(id, { archived_by = null, reason = null } = {}) {
  await ensureExpensesArchiveSchema(pool);
  const query = `
    UPDATE expenses
    SET
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
