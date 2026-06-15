import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";

export const BUDGET_CATEGORY_DEFINITIONS = [
  { key: "sales", label: "Ventes facturees", type: "revenue" },
  { key: "collections", label: "Encaissements clients", type: "cash_in" },
  { key: "gross_profit", label: "Profit brut", type: "margin" },
  { key: "transport", label: "Transport", type: "expense" },
  { key: "marketing", label: "Marketing", type: "expense" },
  { key: "salaires", label: "Salaires", type: "expense" },
  { key: "maintenance", label: "Maintenance", type: "expense" },
  { key: "fret", label: "Fret", type: "expense" },
  { key: "emballages", label: "Emballages", type: "expense" },
  { key: "matieres_premieres", label: "Matieres premieres", type: "expense" },
  { key: "loyer", label: "Loyer", type: "expense" },
  { key: "commissions", label: "Commissions", type: "expense" },
  { key: "divers", label: "Divers", type: "expense" }
];

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getBudgetCategoryDefinitionMap() {
  return new Map(
    BUDGET_CATEGORY_DEFINITIONS.map((item) => [item.key, item])
  );
}

function getElapsedMonthCount(fiscalYear, currentDate = new Date()) {
  const currentYear = currentDate.getFullYear();

  if (fiscalYear < currentYear) {
    return 12;
  }

  if (fiscalYear > currentYear) {
    return 0;
  }

  return currentDate.getMonth() + 1;
}

export async function ensureBudgetSchema(executor = pool) {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      fiscal_year INTEGER NOT NULL,
      warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS budget_lines (
      id SERIAL PRIMARY KEY,
      budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      category_key VARCHAR(60) NOT NULL,
      month_number INTEGER NOT NULL,
      planned_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT budget_lines_month_chk CHECK (month_number BETWEEN 1 AND 12),
      CONSTRAINT budget_lines_amount_chk CHECK (planned_amount >= 0)
    );
  `);

  await executor.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_lines_unique
    ON budget_lines (budget_id, category_key, month_number);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_budgets_fiscal_year
    ON budgets (fiscal_year);
  `);

  await executor.query(`
    CREATE INDEX IF NOT EXISTS idx_budgets_warehouse_id
    ON budgets (warehouse_id);
  `);
}

export async function getAllBudgets() {
  const query = `
    SELECT
      b.id,
      b.name,
      b.fiscal_year,
      b.warehouse_id,
      b.notes,
      b.is_active,
      b.created_at,
      b.updated_at,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COALESCE(SUM(bl.planned_amount), 0) AS total_planned_amount
    FROM budgets b
    LEFT JOIN warehouses w ON w.id = b.warehouse_id
    LEFT JOIN budget_lines bl ON bl.budget_id = b.id
    GROUP BY b.id, w.name, w.city
    ORDER BY b.fiscal_year DESC, b.name ASC, b.id DESC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, values = []) => pool.query(sql, values),
    ensureSchema: () => ensureBudgetSchema(pool),
    query
  });

  return result.rows.map((row) => ({
    ...row,
    total_planned_amount: roundAmount(row.total_planned_amount)
  }));
}

export async function getBudgetById(id) {
  const [budgetResult, linesResult] = await Promise.all([
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensureBudgetSchema(pool),
      query: `
        SELECT
          b.*,
          w.name AS warehouse_name,
          w.city AS warehouse_city
        FROM budgets b
        LEFT JOIN warehouses w ON w.id = b.warehouse_id
        WHERE b.id = $1
        LIMIT 1;
      `,
      values: [id]
    }),
    queryWithSchemaOrColumnRetry({
      executor: (sql, values = []) => pool.query(sql, values),
      ensureSchema: () => ensureBudgetSchema(pool),
      query: `
        SELECT
          bl.id,
          bl.budget_id,
          bl.category_key,
          bl.month_number,
          bl.planned_amount,
          bl.created_at,
          bl.updated_at
        FROM budget_lines bl
        WHERE bl.budget_id = $1
        ORDER BY bl.category_key ASC, bl.month_number ASC;
      `,
      values: [id]
    })
  ]);

  const budget = budgetResult.rows[0] || null;

  if (!budget) {
    return null;
  }

  return {
    ...budget,
    lines: linesResult.rows.map((row) => ({
      ...row,
      planned_amount: roundAmount(row.planned_amount)
    }))
  };
}

function normalizeBudgetLines(lines = []) {
  return lines.map((line) => ({
    category_key: String(line.category_key || "").trim(),
    month_number: Number(line.month_number),
    planned_amount: roundAmount(line.planned_amount)
  }));
}

export async function createBudgetWithLines(data) {
  await ensureBudgetSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const budgetResult = await client.query(
      `
      INSERT INTO budgets (
        name,
        fiscal_year,
        warehouse_id,
        notes,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [
        data.name,
        data.fiscal_year,
        data.warehouse_id || null,
        data.notes || null,
        data.is_active ?? true
      ]
    );

    const budget = budgetResult.rows[0];
    const normalizedLines = normalizeBudgetLines(data.lines);

    for (const line of normalizedLines) {
      await client.query(
        `
        INSERT INTO budget_lines (
          budget_id,
          category_key,
          month_number,
          planned_amount
        )
        VALUES ($1, $2, $3, $4);
        `,
        [budget.id, line.category_key, line.month_number, line.planned_amount]
      );
    }

    await client.query("COMMIT");
    return getBudgetById(budget.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBudgetWithLines(id, data) {
  await ensureBudgetSchema(pool);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const budgetResult = await client.query(
      `
      UPDATE budgets
      SET
        name = $1,
        fiscal_year = $2,
        warehouse_id = $3,
        notes = $4,
        is_active = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *;
      `,
      [
        data.name,
        data.fiscal_year,
        data.warehouse_id || null,
        data.notes || null,
        data.is_active ?? true,
        id
      ]
    );

    const updatedBudget = budgetResult.rows[0] || null;

    if (!updatedBudget) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(`DELETE FROM budget_lines WHERE budget_id = $1;`, [id]);

    const normalizedLines = normalizeBudgetLines(data.lines);

    for (const line of normalizedLines) {
      await client.query(
        `
        INSERT INTO budget_lines (
          budget_id,
          category_key,
          month_number,
          planned_amount
        )
        VALUES ($1, $2, $3, $4);
        `,
        [id, line.category_key, line.month_number, line.planned_amount]
      );
    }

    await client.query("COMMIT");
    return getBudgetById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteBudgetById(id) {
  await ensureBudgetSchema(pool);
  const result = await pool.query(
    `
    DELETE FROM budgets
    WHERE id = $1
    RETURNING *;
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function getBudgetActualValues(budget) {
  const fiscalYear = Number(budget.fiscal_year);
  const warehouseId = budget.warehouse_id ? Number(budget.warehouse_id) : null;

  const [
    salesResult,
    collectionsResult,
    grossProfitResult,
    expensesResult
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        EXTRACT(MONTH FROM i.invoice_date)::int AS month_number,
        COALESCE(SUM(i.total_amount), 0) AS amount
      FROM invoices i
      WHERE EXTRACT(YEAR FROM i.invoice_date) = $1
        AND COALESCE(i.status, 'issued') <> 'cancelled'
        ${warehouseId ? "AND i.warehouse_id = $2" : ""}
      GROUP BY EXTRACT(MONTH FROM i.invoice_date)
      ORDER BY month_number ASC;
      `,
      warehouseId ? [fiscalYear, warehouseId] : [fiscalYear]
    ),
    pool.query(
      `
      SELECT
        EXTRACT(MONTH FROM p.payment_date)::int AS month_number,
        COALESCE(SUM(p.amount), 0) AS amount
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE EXTRACT(YEAR FROM p.payment_date) = $1
        AND COALESCE(i.status, 'issued') <> 'cancelled'
        ${warehouseId ? "AND i.warehouse_id = $2" : ""}
      GROUP BY EXTRACT(MONTH FROM p.payment_date)
      ORDER BY month_number ASC;
      `,
      warehouseId ? [fiscalYear, warehouseId] : [fiscalYear]
    ),
    pool.query(
      `
      SELECT
        EXTRACT(MONTH FROM i.invoice_date)::int AS month_number,
        COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0) AS amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE EXTRACT(YEAR FROM i.invoice_date) = $1
        AND COALESCE(i.status, 'issued') <> 'cancelled'
        ${warehouseId ? "AND i.warehouse_id = $2" : ""}
      GROUP BY EXTRACT(MONTH FROM i.invoice_date)
      ORDER BY month_number ASC;
      `,
      warehouseId ? [fiscalYear, warehouseId] : [fiscalYear]
    ),
    pool.query(
      `
      SELECT
        LOWER(TRIM(e.category)) AS category_key,
        EXTRACT(MONTH FROM e.expense_date)::int AS month_number,
        COALESCE(SUM(e.amount), 0) AS amount
      FROM expenses e
      WHERE EXTRACT(YEAR FROM e.expense_date) = $1
      GROUP BY LOWER(TRIM(e.category)), EXTRACT(MONTH FROM e.expense_date)
      ORDER BY category_key ASC, month_number ASC;
      `,
      [fiscalYear]
    )
  ]);

  const actualMap = new Map();

  function setAmount(categoryKey, monthNumber, amount) {
    const key = `${categoryKey}::${monthNumber}`;
    actualMap.set(key, roundAmount(amount));
  }

  salesResult.rows.forEach((row) => {
    setAmount("sales", Number(row.month_number), row.amount);
  });

  collectionsResult.rows.forEach((row) => {
    setAmount("collections", Number(row.month_number), row.amount);
  });

  grossProfitResult.rows.forEach((row) => {
    setAmount("gross_profit", Number(row.month_number), row.amount);
  });

  expensesResult.rows.forEach((row) => {
    setAmount(row.category_key, Number(row.month_number), row.amount);
  });

  return actualMap;
}

export async function getBudgetVsActual(id) {
  const budget = await getBudgetById(id);

  if (!budget) {
    return null;
  }

  const definitionMap = getBudgetCategoryDefinitionMap();
  const categories = BUDGET_CATEGORY_DEFINITIONS.map((item) => item.key);
  const actualMap = await getBudgetActualValues(budget);
  const budgetMap = new Map();

  (budget.lines || []).forEach((line) => {
    budgetMap.set(
      `${line.category_key}::${Number(line.month_number)}`,
      roundAmount(line.planned_amount)
    );
  });

  const elapsedMonthCount = getElapsedMonthCount(Number(budget.fiscal_year));
  const monthRows = Array.from({ length: elapsedMonthCount }, (_, index) => ({
    month_number: index + 1,
    planned_total: 0,
    actual_total: 0,
    variance_total: 0
  }));

  const rows = categories.map((categoryKey) => {
    const definition =
      definitionMap.get(categoryKey) || {
        key: categoryKey,
        label: categoryKey,
        type: "expense"
      };

    const planned_by_month = {};
    const actual_by_month = {};
    const variance_by_month = {};
    let planned_total = 0;
    let actual_total = 0;

    monthRows.forEach((monthRow) => {
      const monthNumber = monthRow.month_number;
      const budgetKey = `${categoryKey}::${monthNumber}`;
      const plannedAmount = roundAmount(budgetMap.get(budgetKey) || 0);
      const actualAmount = roundAmount(actualMap.get(budgetKey) || 0);
      const varianceAmount = roundAmount(actualAmount - plannedAmount);

      planned_by_month[monthNumber] = plannedAmount;
      actual_by_month[monthNumber] = actualAmount;
      variance_by_month[monthNumber] = varianceAmount;

      planned_total += plannedAmount;
      actual_total += actualAmount;

      monthRow.planned_total = roundAmount(
        monthRow.planned_total + plannedAmount
      );
      monthRow.actual_total = roundAmount(monthRow.actual_total + actualAmount);
      monthRow.variance_total = roundAmount(
        monthRow.actual_total - monthRow.planned_total
      );
    });

    return {
      category_key: categoryKey,
      category_label: definition.label,
      category_type: definition.type,
      planned_by_month,
      actual_by_month,
      variance_by_month,
      planned_total: roundAmount(planned_total),
      actual_total: roundAmount(actual_total),
      variance_total: roundAmount(actual_total - planned_total),
      attainment_percent:
        planned_total > 0
          ? roundAmount((actual_total / planned_total) * 100)
          : 0
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_planned += Number(row.planned_total || 0);
      acc.total_actual += Number(row.actual_total || 0);
      return acc;
    },
    {
      total_planned: 0,
      total_actual: 0
    }
  );

  return {
    budget: {
      ...budget,
      scope_note: budget.warehouse_id
        ? "Les ventes, encaissements et profits sont filtres sur ce depot. Les depenses restent comparees au global tant qu elles ne sont pas affectees a un depot."
        : "Budget global sans filtre depot."
    },
    summary: {
      total_planned: roundAmount(summary.total_planned),
      total_actual: roundAmount(summary.total_actual),
      total_variance: roundAmount(summary.total_actual - summary.total_planned),
      attainment_percent:
        summary.total_planned > 0
          ? roundAmount((summary.total_actual / summary.total_planned) * 100)
          : 0
    },
    rows,
    month_rows: monthRows.map((row) => ({
      ...row,
      month_label: new Intl.DateTimeFormat("fr-FR", {
        month: "short"
      }).format(new Date(2000, row.month_number - 1, 1))
    })),
    categories: BUDGET_CATEGORY_DEFINITIONS
  };
}
