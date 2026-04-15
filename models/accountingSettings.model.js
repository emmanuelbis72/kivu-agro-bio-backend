import { pool } from "../config/db.js";

export async function getAllExpenseCategoryAccounts() {
  const query = `
    SELECT
      eca.id,
      eca.category,
      eca.expense_account_id,
      a.account_number,
      a.account_name,
      eca.created_at,
      eca.updated_at
    FROM expense_category_accounts eca
    INNER JOIN accounts a ON a.id = eca.expense_account_id
    ORDER BY eca.category ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getExpenseCategoryAccountByCategory(category) {
  const query = `
    SELECT
      eca.*,
      a.account_number,
      a.account_name,
      a.is_active,
      a.is_postable
    FROM expense_category_accounts eca
    INNER JOIN accounts a ON a.id = eca.expense_account_id
    WHERE eca.category = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [category]);
  return result.rows[0] || null;
}

export async function upsertExpenseCategoryAccount({ category, expense_account_id }) {
  const query = `
    INSERT INTO expense_category_accounts (category, expense_account_id)
    VALUES ($1, $2)
    ON CONFLICT (category)
    DO UPDATE SET
      expense_account_id = EXCLUDED.expense_account_id,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await pool.query(query, [category, expense_account_id]);
  return result.rows[0];
}

export async function getAllPaymentMethodAccounts() {
  const query = `
    SELECT
      pma.id,
      pma.payment_method,
      pma.treasury_account_id,
      a.account_number,
      a.account_name,
      pma.created_at,
      pma.updated_at
    FROM payment_method_accounts pma
    INNER JOIN accounts a ON a.id = pma.treasury_account_id
    ORDER BY pma.payment_method ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getPaymentMethodAccountByMethod(paymentMethod) {
  const query = `
    SELECT
      pma.*,
      a.account_number,
      a.account_name,
      a.is_active,
      a.is_postable
    FROM payment_method_accounts pma
    INNER JOIN accounts a ON a.id = pma.treasury_account_id
    WHERE pma.payment_method = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [paymentMethod]);
  return result.rows[0] || null;
}

export async function upsertPaymentMethodAccount({
  payment_method,
  treasury_account_id
}) {
  const query = `
    INSERT INTO payment_method_accounts (payment_method, treasury_account_id)
    VALUES ($1, $2)
    ON CONFLICT (payment_method)
    DO UPDATE SET
      treasury_account_id = EXCLUDED.treasury_account_id,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await pool.query(query, [payment_method, treasury_account_id]);
  return result.rows[0];
}