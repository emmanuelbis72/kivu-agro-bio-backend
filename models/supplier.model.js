import { pool } from "../config/db.js";
import {
  ensureColumnSchema,
  ensureTableSchema,
  queryWithSchemaOrColumnRetry
} from "../utils/schemaSelfHealing.util.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function ensureSuppliersSchema(executor = pool) {
  const run = (sql, values = []) => executor.query(sql, values);

  await ensureTableSchema({
    executor: (sql) => run(sql),
    relationName: "suppliers",
    createSql: `
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        supplier_type VARCHAR(50) NOT NULL DEFAULT 'vendor',
        business_name VARCHAR(150) NOT NULL,
        contact_name VARCHAR(150),
        phone VARCHAR(50),
        email VARCHAR(150),
        city VARCHAR(120),
        address TEXT,
        payment_terms_days INTEGER NOT NULL DEFAULT 0,
        credit_limit NUMERIC(14, 2) NOT NULL DEFAULT 0,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        payable_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `
  });

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_business_name_normalized
    ON suppliers (LOWER(BTRIM(business_name)));
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_suppliers_payable_account_id
    ON suppliers(payable_account_id);
  `);

  await ensureColumnSchema({
    executor: (sql) => run(sql),
    alterSql: `
      ALTER TABLE expenses
      ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
    `
  });

  await run(`
    CREATE INDEX IF NOT EXISTS idx_expenses_supplier_id
    ON expenses(supplier_id);
  `);

  await run(`
    INSERT INTO suppliers (
      supplier_type,
      business_name,
      is_active,
      created_at,
      updated_at
    )
    SELECT
      'vendor',
      source.normalized_supplier,
      TRUE,
      NOW(),
      NOW()
    FROM (
      SELECT DISTINCT BTRIM(supplier) AS normalized_supplier
      FROM expenses
      WHERE supplier IS NOT NULL
        AND BTRIM(supplier) <> ''
    ) AS source
    WHERE NOT EXISTS (
      SELECT 1
      FROM suppliers s
      WHERE LOWER(BTRIM(s.business_name)) = LOWER(source.normalized_supplier)
    );
  `);

  await run(`
    UPDATE expenses e
    SET supplier_id = s.id
    FROM suppliers s
    WHERE e.supplier_id IS NULL
      AND e.supplier IS NOT NULL
      AND BTRIM(e.supplier) <> ''
      AND LOWER(BTRIM(s.business_name)) = LOWER(BTRIM(e.supplier));
  `);
}

export async function createSupplier(data) {
  await ensureSuppliersSchema(pool);

  const query = `
    INSERT INTO suppliers (
      supplier_type,
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
      payable_account_id
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *;
  `;

  const values = [
    data.supplier_type || "vendor",
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
    data.payable_account_id || null
  ];

  const result = await pool.query(query, values);
  return getSupplierById(result.rows[0].id);
}

export async function getAllSuppliers() {
  const query = `
    SELECT
      s.*,
      a.account_number AS payable_account_number,
      a.account_name AS payable_account_name,
      COALESCE(stats.expense_count, 0)::int AS expense_count,
      COALESCE(stats.total_expenses, 0) AS total_expenses,
      stats.last_expense_date
    FROM suppliers s
    LEFT JOIN accounts a ON a.id = s.payable_account_id
    LEFT JOIN (
      SELECT
        supplier_id,
        COUNT(*)::int AS expense_count,
        COALESCE(SUM(amount), 0) AS total_expenses,
        MAX(expense_date) AS last_expense_date
      FROM expenses
      WHERE supplier_id IS NOT NULL
      GROUP BY supplier_id
    ) AS stats ON stats.supplier_id = s.id
    ORDER BY s.created_at DESC, s.id DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureSuppliersSchema(pool),
    query
  });

  return result.rows.map((row) => ({
    ...row,
    total_expenses: roundAmount(row.total_expenses)
  }));
}

export async function getSupplierById(id) {
  const query = `
    SELECT
      s.*,
      a.account_number AS payable_account_number,
      a.account_name AS payable_account_name,
      COALESCE(stats.expense_count, 0)::int AS expense_count,
      COALESCE(stats.total_expenses, 0) AS total_expenses,
      stats.last_expense_date
    FROM suppliers s
    LEFT JOIN accounts a ON a.id = s.payable_account_id
    LEFT JOIN (
      SELECT
        supplier_id,
        COUNT(*)::int AS expense_count,
        COALESCE(SUM(amount), 0) AS total_expenses,
        MAX(expense_date) AS last_expense_date
      FROM expenses
      WHERE supplier_id IS NOT NULL
      GROUP BY supplier_id
    ) AS stats ON stats.supplier_id = s.id
    WHERE s.id = $1
    LIMIT 1;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureSuppliersSchema(pool),
    query,
    values: [id]
  });

  if (!result.rows[0]) {
    return null;
  }

  return {
    ...result.rows[0],
    total_expenses: roundAmount(result.rows[0].total_expenses)
  };
}

export async function getSupplierByBusinessName(businessName) {
  await ensureSuppliersSchema(pool);

  const result = await pool.query(
    `
    SELECT *
    FROM suppliers
    WHERE LOWER(BTRIM(business_name)) = LOWER(BTRIM($1))
    LIMIT 1;
    `,
    [businessName]
  );

  return result.rows[0] || null;
}

export async function updateSupplier(id, data) {
  await ensureSuppliersSchema(pool);

  const query = `
    UPDATE suppliers
    SET
      supplier_type = $1,
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
      payable_account_id = $12,
      updated_at = NOW()
    WHERE id = $13
    RETURNING *;
  `;

  const values = [
    data.supplier_type || "vendor",
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
    data.payable_account_id || null,
    id
  ];

  const result = await pool.query(query, values);

  if (!result.rows[0]) {
    return null;
  }

  await pool.query(
    `
      UPDATE expenses
      SET supplier = $1
      WHERE supplier_id = $2;
    `,
    [data.business_name, id]
  );

  return getSupplierById(id);
}

export async function deleteSupplier(id) {
  await ensureSuppliersSchema(pool);

  const query = `
    DELETE FROM suppliers
    WHERE id = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}
