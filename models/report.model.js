import { pool } from "../config/db.js";
import {
  COLLECTION_ALERT_LEVELS,
  COLLECTION_PAYMENT_STATUSES,
  normalizeCollectionInvoice
} from "../utils/collectionStatus.util.js";
import { getIncomeStatement } from "./accountingReport.model.js";
import {
  ensureBudgetSchema,
  getAllBudgets,
  getBudgetVsActual
} from "./budget.model.js";
import { getCashForecast } from "./dashboard.model.js";
import { ensurePurchaseInvoicesSchema } from "./purchaseInvoice.model.js";
import { normalizeCustomerBalanceRow } from "../utils/customerBalance.util.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function getCollectionsReport(filters = {}) {
  await ensureReportsSchema(pool);

  const asOfDate =
    filters.asOfDate || new Date().toISOString().split("T")[0];
  const paymentStatus = COLLECTION_PAYMENT_STATUSES.includes(
    filters.paymentStatus
  )
    ? filters.paymentStatus
    : "all";
  const alertLevel = COLLECTION_ALERT_LEVELS.includes(filters.alertLevel)
    ? filters.alertLevel
    : "all";
  const limit = Math.min(Math.max(Number(filters.limit || 5000), 1), 5000);
  const values = [asOfDate];
  const conditions = [
    "$1::date IS NOT NULL",
    "i.status IN ('issued', 'partial', 'paid')"
  ];

  function addCondition(value, sqlBuilder) {
    if (value === undefined || value === null || value === "") {
      return;
    }

    values.push(value);
    conditions.push(sqlBuilder(values.length));
  }

  addCondition(filters.startDate, (index) => `i.invoice_date >= $${index}`);
  addCondition(filters.endDate, (index) => `i.invoice_date <= $${index}`);
  addCondition(filters.warehouseId, (index) => `i.warehouse_id = $${index}`);
  addCondition(filters.customerId, (index) => `i.customer_id = $${index}`);
  addCondition(
    filters.customerCity,
    (index) => `LOWER(COALESCE(c.city, '')) = LOWER($${index})`
  );

  if (paymentStatus === "open") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
  } else if (paymentStatus === "unpaid") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push("COALESCE(i.paid_amount, 0) <= 0");
  } else if (paymentStatus === "partial") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push("COALESCE(i.paid_amount, 0) > 0");
  } else if (paymentStatus === "paid") {
    conditions.push("COALESCE(i.balance_due, 0) <= 0");
  }

  const ageExpression = "GREATEST(($1::date - i.invoice_date), 0)";

  if (alertLevel === "green") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push(`${ageExpression} <= 21`);
  } else if (alertLevel === "light_green") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push(`${ageExpression} BETWEEN 22 AND 29`);
  } else if (alertLevel === "orange") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push(`${ageExpression} BETWEEN 30 AND 44`);
  } else if (alertLevel === "red") {
    conditions.push("COALESCE(i.balance_due, 0) > 0");
    conditions.push(`${ageExpression} >= 45`);
  }

  values.push(limit);
  const query = `
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      i.status,
      i.customer_id,
      c.business_name AS customer_name,
      COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS customer_city,
      i.warehouse_id,
      COALESCE(w.name, 'Depot non renseigne') AS warehouse_name,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.paid_amount, 0) AS paid_amount,
      COALESCE(i.balance_due, 0) AS balance_due,
      ${ageExpression}::int AS collection_age_days
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      CASE WHEN COALESCE(i.balance_due, 0) > 0 THEN 0 ELSE 1 END,
      collection_age_days DESC,
      i.balance_due DESC,
      i.invoice_date DESC,
      i.id DESC
    LIMIT $${values.length};
  `;

  const result = await pool.query(query, values);
  const rows = result.rows.map(normalizeCollectionInvoice);
  const customerIds = new Set();
  const summary = rows.reduce(
    (acc, row) => {
      customerIds.add(row.customer_id);
      acc.total_invoices += 1;
      acc.total_invoiced_amount += row.total_amount;
      acc.total_paid_amount += row.paid_amount;
      acc.total_balance_due += row.balance_due;

      if (row.payment_status === "paid") {
        acc.paid_invoices_count += 1;
        acc.paid_invoices_amount += row.total_amount;
      } else if (row.payment_status === "partial") {
        acc.partial_invoices_count += 1;
        acc.partial_balance_amount += row.balance_due;
      } else {
        acc.unpaid_invoices_count += 1;
        acc.unpaid_balance_amount += row.balance_due;
      }

      if (row.alert_level !== "paid") {
        acc[`${row.alert_level}_invoices_count`] += 1;
        acc[`${row.alert_level}_balance_amount`] += row.balance_due;
      }

      return acc;
    },
    {
      total_invoices: 0,
      total_invoiced_amount: 0,
      total_paid_amount: 0,
      total_balance_due: 0,
      paid_invoices_count: 0,
      paid_invoices_amount: 0,
      partial_invoices_count: 0,
      partial_balance_amount: 0,
      unpaid_invoices_count: 0,
      unpaid_balance_amount: 0,
      green_invoices_count: 0,
      green_balance_amount: 0,
      light_green_invoices_count: 0,
      light_green_balance_amount: 0,
      orange_invoices_count: 0,
      orange_balance_amount: 0,
      red_invoices_count: 0,
      red_balance_amount: 0
    }
  );

  Object.keys(summary).forEach((key) => {
    if (key.endsWith("_amount") || key === "total_balance_due") {
      summary[key] = roundAmount(summary[key]);
    }
  });

  return {
    filters: {
      start_date: filters.startDate || null,
      end_date: filters.endDate || null,
      as_of_date: asOfDate,
      warehouse_id: filters.warehouseId || null,
      customer_id: filters.customerId || null,
      customer_city: filters.customerCity || null,
      payment_status: paymentStatus,
      alert_level: alertLevel
    },
    summary: {
      ...summary,
      total_customers: customerIds.size,
      collection_rate_percent:
        summary.total_invoiced_amount > 0
          ? roundAmount(
              (summary.total_paid_amount / summary.total_invoiced_amount) * 100
            )
          : 0
    },
    rows
  };
}

async function ensureReportsSchema(executor = pool) {
  await ensurePurchaseInvoicesSchema(executor);
  await ensureBudgetSchema(executor);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS chain_name VARCHAR(150);
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS sales_channel VARCHAR(80);
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS commercial_name VARCHAR(150);
  `);
  await executor.query(`
    CREATE TABLE IF NOT EXISTS commission_profiles (
      id SERIAL PRIMARY KEY,
      beneficiary_type VARCHAR(20) NOT NULL,
      beneficiary_name VARCHAR(150) NOT NULL,
      commission_rate_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT commission_profiles_type_chk CHECK (
        beneficiary_type IN ('commercial', 'reseller')
      ),
      CONSTRAINT commission_profiles_rate_chk CHECK (
        commission_rate_percent >= 0 AND commission_rate_percent <= 100
      )
    );
  `);
  await executor.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_profiles_unique
    ON commission_profiles (
      beneficiary_type,
      LOWER(TRIM(beneficiary_name))
    );
  `);
}

function buildInvoiceScopeFilters(filters = {}, aliases = {}) {
  const invoiceAlias = aliases.invoice || "i";
  const customerAlias = aliases.customer || "c";
  const conditions = [`${invoiceAlias}.status IN ('issued', 'partial', 'paid')`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${invoiceAlias}.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${invoiceAlias}.invoice_date <= $${values.length}`);
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${invoiceAlias}.warehouse_id = $${values.length}`);
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`${invoiceAlias}.customer_id = $${values.length}`);
  }

  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`ii.product_id = $${values.length}`);
  }

  if (filters.customerCity) {
    values.push(filters.customerCity);
    conditions.push(
      `LOWER(COALESCE(${customerAlias}.city, '')) = LOWER($${values.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildPaymentJournalFilters(filters = {}, aliases = {}) {
  const paymentAlias = aliases.payment || "p";
  const invoiceAlias = aliases.invoice || "i";
  const conditions = [`1 = 1`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${paymentAlias}.payment_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${paymentAlias}.payment_date <= $${values.length}`);
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${invoiceAlias}.warehouse_id = $${values.length}`);
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`${invoiceAlias}.customer_id = $${values.length}`);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildExpenseFilters(filters = {}, aliases = {}) {
  const expenseAlias = aliases.expense || "e";
  const conditions = [`1 = 1`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${expenseAlias}.expense_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${expenseAlias}.expense_date <= $${values.length}`);
  }

  if (filters.category) {
    values.push(filters.category);
    conditions.push(
      `LOWER(COALESCE(${expenseAlias}.category, '')) = LOWER($${values.length})`
    );
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildSalesDetailFilters(filters = {}) {
  const conditions = [
    `i.status IN ('issued', 'partial', 'paid')`
  ];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`i.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`i.invoice_date <= $${values.length}`);
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`i.warehouse_id = $${values.length}`);
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`i.customer_id = $${values.length}`);
  }

  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`ii.product_id = $${values.length}`);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildProductSalesFilters(filters = {}) {
  const conditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`i.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`i.invoice_date <= $${values.length}`);
  }

  if (Array.isArray(filters.warehouseIds) && filters.warehouseIds.length > 0) {
    values.push(filters.warehouseIds);
    conditions.push(`i.warehouse_id = ANY($${values.length}::int[])`);
  }

  if (Array.isArray(filters.customerIds) && filters.customerIds.length > 0) {
    values.push(filters.customerIds);
    conditions.push(`i.customer_id = ANY($${values.length}::int[])`);
  }

  if (Array.isArray(filters.productIds) && filters.productIds.length > 0) {
    values.push(filters.productIds);
    conditions.push(`ii.product_id = ANY($${values.length}::int[])`);
  }

  if (filters.invoiceStatus) {
    values.push(filters.invoiceStatus);
    conditions.push(`i.status = $${values.length}`);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildProductLedgerFilters(filters = {}) {
  const conditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`i.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`i.invoice_date <= $${values.length}`);
  }

  if (Array.isArray(filters.warehouseIds) && filters.warehouseIds.length > 0) {
    values.push(filters.warehouseIds);
    conditions.push(`i.warehouse_id = ANY($${values.length}::int[])`);
  }

  if (Array.isArray(filters.customerIds) && filters.customerIds.length > 0) {
    values.push(filters.customerIds);
    conditions.push(`i.customer_id = ANY($${values.length}::int[])`);
  }

  if (Array.isArray(filters.productIds) && filters.productIds.length > 0) {
    values.push(filters.productIds);
    conditions.push(`ii.product_id = ANY($${values.length}::int[])`);
  }

  if (filters.invoiceStatus) {
    values.push(filters.invoiceStatus);
    conditions.push(`i.status = $${values.length}`);
  }

  if (filters.invoiceNumber) {
    values.push(`%${String(filters.invoiceNumber).trim()}%`);
    conditions.push(`LOWER(i.invoice_number) LIKE LOWER($${values.length})`);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildCommercialAggregateFilters(filters = {}) {
  const conditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`i.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`i.invoice_date <= $${values.length}`);
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`i.warehouse_id = $${values.length}`);
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`i.customer_id = $${values.length}`);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    values
  };
}

function buildStockStateFilters(filters = {}) {
  const conditions = [];
  const values = [];

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`ws.warehouse_id = $${values.length}`);
  }

  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`ws.product_id = $${values.length}`);
  }

  if (filters.lowStockOnly) {
    conditions.push(`ws.quantity <= COALESCE(p.alert_threshold, 0)`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

function buildCustomerLedgerFilters(filters = {}) {
  const invoiceConditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const values = [];

  if (filters.startDate) {
    values.push(filters.startDate);
    invoiceConditions.push(`i.invoice_date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    invoiceConditions.push(`i.invoice_date <= $${values.length}`);
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    invoiceConditions.push(`i.customer_id = $${values.length}`);
  }

  return {
    invoiceWhereClause: `WHERE ${invoiceConditions.join(" AND ")}`,
    values
  };
}

export async function getCustomerAgingReport({
  asOfDate,
  warehouseId = null
}) {
  await ensureReportsSchema(pool);

  const values = [asOfDate];
  const warehouseClause = warehouseId
    ? `AND i.warehouse_id = $${values.push(warehouseId)}`
    : "";

  const query = `
    WITH open_invoices AS (
      SELECT
        i.id,
        i.customer_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.status,
        COALESCE(i.total_amount, 0) AS total_amount,
        COALESCE(i.paid_amount, 0) AS paid_amount,
        COALESCE(i.balance_due, 0) AS balance_due,
        CASE
          WHEN i.due_date IS NULL THEN NULL
          ELSE GREATEST(($1::date - i.due_date), 0)
        END AS days_overdue
      FROM invoices i
      WHERE i.status IN ('issued', 'partial')
        AND COALESCE(i.balance_due, 0) > 0
        ${warehouseClause}
    )
    SELECT
      c.id AS customer_id,
      c.business_name,
      c.city,
      COUNT(oi.id)::int AS open_invoices_count,
      MIN(oi.due_date) AS oldest_due_date,
      MAX(oi.invoice_date) AS last_invoice_date,
      COALESCE(SUM(oi.balance_due), 0) AS total_balance_due,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NULL OR oi.due_date >= $1::date
          THEN oi.balance_due
        ELSE 0
      END), 0) AS current_balance,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 1 AND 30
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_1_30,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 31 AND 60
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_31_60,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 61 AND 90
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_61_90,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue > 90
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_90_plus,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NULL
          THEN oi.balance_due
        ELSE 0
      END), 0) AS undated_balance
    FROM customers c
    INNER JOIN open_invoices oi ON oi.customer_id = c.id
    GROUP BY c.id, c.business_name, c.city
    ORDER BY total_balance_due DESC, c.business_name ASC;
  `;

  const result = await pool.query(query, values);
  const rows = result.rows.map((row) => ({
    ...row,
    open_invoices_count: Number(row.open_invoices_count || 0),
    total_balance_due: roundAmount(row.total_balance_due),
    current_balance: roundAmount(row.current_balance),
    bucket_1_30: roundAmount(row.bucket_1_30),
    bucket_31_60: roundAmount(row.bucket_31_60),
    bucket_61_90: roundAmount(row.bucket_61_90),
    bucket_90_plus: roundAmount(row.bucket_90_plus),
    undated_balance: roundAmount(row.undated_balance)
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_customers += 1;
      acc.open_invoices_count += Number(row.open_invoices_count || 0);
      acc.total_balance_due += Number(row.total_balance_due || 0);
      acc.current_balance += Number(row.current_balance || 0);
      acc.bucket_1_30 += Number(row.bucket_1_30 || 0);
      acc.bucket_31_60 += Number(row.bucket_31_60 || 0);
      acc.bucket_61_90 += Number(row.bucket_61_90 || 0);
      acc.bucket_90_plus += Number(row.bucket_90_plus || 0);
      acc.undated_balance += Number(row.undated_balance || 0);
      return acc;
    },
    {
      total_customers: 0,
      open_invoices_count: 0,
      total_balance_due: 0,
      current_balance: 0,
      bucket_1_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_90_plus: 0,
      undated_balance: 0
    }
  );

  return {
    summary: {
      ...summary,
      total_balance_due: roundAmount(summary.total_balance_due),
      current_balance: roundAmount(summary.current_balance),
      bucket_1_30: roundAmount(summary.bucket_1_30),
      bucket_31_60: roundAmount(summary.bucket_31_60),
      bucket_61_90: roundAmount(summary.bucket_61_90),
      bucket_90_plus: roundAmount(summary.bucket_90_plus),
      undated_balance: roundAmount(summary.undated_balance)
    },
    rows
  };
}

export async function getCustomerLedgerReport(filters = {}) {
  await ensureReportsSchema(pool);

  const { invoiceWhereClause, values } =
    buildCustomerLedgerFilters(filters);

  const query = `
    WITH filtered_invoices AS (
      SELECT
        i.id,
        i.customer_id,
        i.invoice_date,
        i.total_amount,
        i.paid_amount,
        i.balance_due
      FROM invoices i
      ${invoiceWhereClause}
    ),
    invoice_summary AS (
      SELECT
        fi.customer_id,
        COUNT(fi.id)::int AS invoices_count,
        COALESCE(SUM(fi.total_amount), 0) AS invoiced_amount,
        COALESCE(SUM(fi.paid_amount), 0) AS paid_amount,
        COALESCE(SUM(fi.balance_due), 0) AS balance_due_amount,
        MAX(fi.invoice_date) AS last_invoice_date
      FROM filtered_invoices fi
      GROUP BY fi.customer_id
    ),
    payment_summary AS (
      SELECT
        fi.customer_id,
        COUNT(p.id)::int AS payments_count,
        MAX(p.payment_date) AS last_payment_date
      FROM payments p
      INNER JOIN filtered_invoices fi ON fi.id = p.invoice_id
      GROUP BY fi.customer_id
    )
    SELECT
      c.id AS customer_id,
      c.business_name,
      c.city,
      COALESCE(inv.invoices_count, 0) AS invoices_count,
      COALESCE(pay.payments_count, 0) AS payments_count,
      COALESCE(inv.invoiced_amount, 0) AS invoiced_amount,
      COALESCE(inv.paid_amount, 0) AS paid_amount,
      COALESCE(inv.balance_due_amount, 0) AS balance_due_amount,
      COALESCE(inv.balance_due_amount, 0) AS balance_amount,
      inv.last_invoice_date,
      pay.last_payment_date
    FROM customers c
    LEFT JOIN invoice_summary inv ON inv.customer_id = c.id
    LEFT JOIN payment_summary pay ON pay.customer_id = c.id
    WHERE COALESCE(inv.invoices_count, 0) > 0
       OR COALESCE(pay.payments_count, 0) > 0
    ORDER BY LOWER(TRIM(c.business_name)) ASC;
  `;

  const result = await pool.query(query, values);
  const rows = result.rows.map(normalizeCustomerBalanceRow);

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_customers += 1;
      acc.invoices_count += Number(row.invoices_count || 0);
      acc.payments_count += Number(row.payments_count || 0);
      acc.invoiced_amount += Number(row.invoiced_amount || 0);
      acc.paid_amount += Number(row.paid_amount || 0);
      acc.balance_amount += Number(row.balance_amount || 0);
      return acc;
    },
    {
      total_customers: 0,
      invoices_count: 0,
      payments_count: 0,
      invoiced_amount: 0,
      paid_amount: 0,
      balance_amount: 0
    }
  );

  return {
    summary: {
      total_customers: Number(summary.total_customers || 0),
      invoices_count: Number(summary.invoices_count || 0),
      payments_count: Number(summary.payments_count || 0),
      invoiced_amount: roundAmount(summary.invoiced_amount),
      paid_amount: roundAmount(summary.paid_amount),
      balance_amount: roundAmount(summary.balance_amount)
    },
    rows
  };
}

export async function getSupplierAgingReport({
  asOfDate,
  warehouseId = null
}) {
  await ensureReportsSchema(pool);

  const values = [asOfDate];
  const warehouseClause = warehouseId
    ? `AND pi.warehouse_id = $${values.push(warehouseId)}`
    : "";

  const query = `
    WITH open_invoices AS (
      SELECT
        pi.id,
        pi.supplier_id,
        pi.purchase_invoice_number,
        pi.invoice_date,
        pi.due_date,
        pi.status,
        COALESCE(pi.total_amount, 0) AS total_amount,
        COALESCE(pi.paid_amount, 0) AS paid_amount,
        COALESCE(pi.balance_due, 0) AS balance_due,
        CASE
          WHEN pi.due_date IS NULL THEN NULL
          ELSE GREATEST(($1::date - pi.due_date), 0)
        END AS days_overdue
      FROM purchase_invoices pi
      WHERE pi.status IN ('issued', 'partial')
        AND COALESCE(pi.balance_due, 0) > 0
        ${warehouseClause}
    )
    SELECT
      s.id AS supplier_id,
      s.business_name,
      s.city,
      COUNT(oi.id)::int AS open_invoices_count,
      MIN(oi.due_date) AS oldest_due_date,
      MAX(oi.invoice_date) AS last_invoice_date,
      COALESCE(SUM(oi.balance_due), 0) AS total_balance_due,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NULL OR oi.due_date >= $1::date
          THEN oi.balance_due
        ELSE 0
      END), 0) AS current_balance,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 1 AND 30
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_1_30,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 31 AND 60
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_31_60,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue BETWEEN 61 AND 90
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_61_90,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NOT NULL
         AND oi.days_overdue > 90
          THEN oi.balance_due
        ELSE 0
      END), 0) AS bucket_90_plus,
      COALESCE(SUM(CASE
        WHEN oi.due_date IS NULL
          THEN oi.balance_due
        ELSE 0
      END), 0) AS undated_balance
    FROM suppliers s
    INNER JOIN open_invoices oi ON oi.supplier_id = s.id
    GROUP BY s.id, s.business_name, s.city
    ORDER BY total_balance_due DESC, s.business_name ASC;
  `;

  const result = await pool.query(query, values);
  const rows = result.rows.map((row) => ({
    ...row,
    open_invoices_count: Number(row.open_invoices_count || 0),
    total_balance_due: roundAmount(row.total_balance_due),
    current_balance: roundAmount(row.current_balance),
    bucket_1_30: roundAmount(row.bucket_1_30),
    bucket_31_60: roundAmount(row.bucket_31_60),
    bucket_61_90: roundAmount(row.bucket_61_90),
    bucket_90_plus: roundAmount(row.bucket_90_plus),
    undated_balance: roundAmount(row.undated_balance)
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_suppliers += 1;
      acc.open_invoices_count += Number(row.open_invoices_count || 0);
      acc.total_balance_due += Number(row.total_balance_due || 0);
      acc.current_balance += Number(row.current_balance || 0);
      acc.bucket_1_30 += Number(row.bucket_1_30 || 0);
      acc.bucket_31_60 += Number(row.bucket_31_60 || 0);
      acc.bucket_61_90 += Number(row.bucket_61_90 || 0);
      acc.bucket_90_plus += Number(row.bucket_90_plus || 0);
      acc.undated_balance += Number(row.undated_balance || 0);
      return acc;
    },
    {
      total_suppliers: 0,
      open_invoices_count: 0,
      total_balance_due: 0,
      current_balance: 0,
      bucket_1_30: 0,
      bucket_31_60: 0,
      bucket_61_90: 0,
      bucket_90_plus: 0,
      undated_balance: 0
    }
  );

  return {
    summary: {
      ...summary,
      total_balance_due: roundAmount(summary.total_balance_due),
      current_balance: roundAmount(summary.current_balance),
      bucket_1_30: roundAmount(summary.bucket_1_30),
      bucket_31_60: roundAmount(summary.bucket_31_60),
      bucket_61_90: roundAmount(summary.bucket_61_90),
      bucket_90_plus: roundAmount(summary.bucket_90_plus),
      undated_balance: roundAmount(summary.undated_balance)
    },
    rows
  };
}

export async function getSalesDetailReport(filters = {}, limit = 200) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildSalesDetailFilters(filters);
  const finalValues = [...values, limit];

  const query = `
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.invoice_date,
      i.status,
      c.id AS customer_id,
      c.business_name AS customer_name,
      c.city AS customer_city,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      ii.quantity,
      ii.unit_price,
      ii.line_total,
      COALESCE(p.cost_price, 0) AS unit_cost,
      (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
      (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount,
      CASE
        WHEN ii.line_total > 0
          THEN ROUND(
            ((ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) / ii.line_total) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    INNER JOIN products p ON p.id = ii.product_id
    ${whereClause}
    ORDER BY i.invoice_date DESC, i.id DESC, ii.id ASC
    LIMIT $${finalValues.length};
  `;

  const result = await pool.query(query, finalValues);
  const rows = result.rows.map((row) => ({
    ...row,
    quantity: roundAmount(row.quantity),
    unit_price: roundAmount(row.unit_price),
    line_total: roundAmount(row.line_total),
    unit_cost: roundAmount(row.unit_cost),
    line_cogs_amount: roundAmount(row.line_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0)
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_lines += 1;
      acc.invoice_ids.add(row.invoice_id);
      acc.total_quantity += Number(row.quantity || 0);
      acc.total_sales_amount += Number(row.line_total || 0);
      acc.total_cogs_amount += Number(row.line_cogs_amount || 0);
      acc.gross_profit_amount += Number(row.gross_profit_amount || 0);
      return acc;
    },
    {
      total_lines: 0,
      invoice_ids: new Set(),
      total_quantity: 0,
      total_sales_amount: 0,
      total_cogs_amount: 0,
      gross_profit_amount: 0
    }
  );

  return {
    summary: {
      total_lines: summary.total_lines,
      total_invoices: summary.invoice_ids.size,
      total_quantity: roundAmount(summary.total_quantity),
      total_sales_amount: roundAmount(summary.total_sales_amount),
      total_cogs_amount: roundAmount(summary.total_cogs_amount),
      gross_profit_amount: roundAmount(summary.gross_profit_amount),
      gross_margin_percent:
        summary.total_sales_amount > 0
          ? roundAmount(
              (summary.gross_profit_amount / summary.total_sales_amount) * 100
            )
          : 0
    },
    rows
  };
}

export async function getProductSalesReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildProductSalesFilters(filters);
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH base_sales AS (
      SELECT
        i.id AS invoice_id,
        i.invoice_date,
        i.status,
        c.id AS customer_id,
        c.business_name AS customer_name,
        c.city AS customer_city,
        w.id AS warehouse_id,
        w.name AS warehouse_name,
        w.city AS warehouse_city,
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        p.category,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    )
    SELECT
      bs.product_id,
      bs.product_name,
      bs.sku,
      bs.category,
      bs.warehouse_id,
      bs.warehouse_name,
      bs.warehouse_city,
      bs.customer_id,
      bs.customer_name,
      bs.customer_city,
      COUNT(DISTINCT bs.invoice_id)::int AS invoices_count,
      MIN(bs.invoice_date) AS first_invoice_date,
      MAX(bs.invoice_date) AS last_invoice_date,
      COALESCE(SUM(bs.quantity), 0) AS total_quantity,
      COALESCE(SUM(bs.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(bs.line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(bs.gross_profit_amount), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(bs.line_total), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(bs.gross_profit_amount), 0) / COALESCE(SUM(bs.line_total), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM base_sales bs
    GROUP BY
      bs.product_id,
      bs.product_name,
      bs.sku,
      bs.category,
      bs.warehouse_id,
      bs.warehouse_name,
      bs.warehouse_city,
      bs.customer_id,
      bs.customer_name,
      bs.customer_city
    ORDER BY
      bs.product_name ASC,
      bs.warehouse_name ASC,
      bs.customer_name ASC,
      MAX(bs.invoice_date) DESC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH base_sales AS (
      SELECT
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        ii.product_id,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    )
    SELECT
      COUNT(DISTINCT product_id)::int AS total_products,
      COUNT(DISTINCT warehouse_id)::int AS total_warehouses,
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT invoice_id)::int AS total_invoices,
      COALESCE(SUM(quantity), 0) AS total_quantity,
      COALESCE(SUM(line_total), 0) AS total_sales_amount,
      COALESCE(SUM(line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount
    FROM base_sales;
  `;

  const [groupedResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const result = groupedResult;
  const rows = result.rows.map((row) => ({
    ...row,
    invoices_count: Number(row.invoices_count || 0),
    total_quantity: roundAmount(row.total_quantity),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0)
  }));

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);

  return {
    summary: {
      total_rows: rows.length,
      total_products: Number(summaryRow.total_products || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_customers: Number(summaryRow.total_customers || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      gross_margin_percent:
        totalSalesAmount > 0
          ? roundAmount((grossProfitAmount / totalSalesAmount) * 100)
          : 0
    },
    rows
  };
}

export async function getProductLedgerReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildProductLedgerFilters(filters);
  const finalValues = [...values, limit];

  const rowsQuery = `
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.invoice_date,
      i.status AS invoice_status,
      COALESCE(i.total_amount, 0) AS invoice_total_amount,
      COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
      COALESCE(i.balance_due, 0) AS invoice_balance_due,
      c.id AS customer_id,
      c.business_name AS customer_name,
      c.city AS customer_city,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      ii.quantity,
      ii.unit_price,
      ii.line_total,
      COALESCE(p.cost_price, 0) AS unit_cost,
      (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
      (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount,
      CASE
        WHEN ii.line_total > 0
          THEN ROUND(
            ((ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) / ii.line_total) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    INNER JOIN products p ON p.id = ii.product_id
    ${whereClause}
    ORDER BY i.invoice_date DESC, i.id DESC, p.name ASC, ii.id ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH filtered_lines AS (
      SELECT
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        ii.product_id,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount,
        COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
        COALESCE(i.balance_due, 0) AS invoice_balance_due
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    ),
    filtered_invoices AS (
      SELECT
        invoice_id,
        MAX(customer_id) AS customer_id,
        MAX(warehouse_id) AS warehouse_id,
        MAX(invoice_paid_amount) AS invoice_paid_amount,
        MAX(invoice_balance_due) AS invoice_balance_due
      FROM filtered_lines
      GROUP BY invoice_id
    )
    SELECT
      (SELECT COUNT(*)::int FROM filtered_lines) AS total_lines,
      (SELECT COUNT(DISTINCT product_id)::int FROM filtered_lines) AS total_products,
      (SELECT COUNT(DISTINCT customer_id)::int FROM filtered_invoices) AS total_customers,
      (SELECT COUNT(DISTINCT warehouse_id)::int FROM filtered_invoices) AS total_warehouses,
      (SELECT COUNT(*)::int FROM filtered_invoices) AS total_invoices,
      (SELECT COALESCE(SUM(quantity), 0) FROM filtered_lines) AS total_quantity,
      (SELECT COALESCE(SUM(line_total), 0) FROM filtered_lines) AS total_sales_amount,
      (SELECT COALESCE(SUM(line_cogs_amount), 0) FROM filtered_lines) AS total_cogs_amount,
      (SELECT COALESCE(SUM(gross_profit_amount), 0) FROM filtered_lines) AS gross_profit_amount,
      (SELECT COALESCE(SUM(invoice_paid_amount), 0) FROM filtered_invoices) AS total_paid_amount,
      (SELECT COALESCE(SUM(invoice_balance_due), 0) FROM filtered_invoices) AS total_balance_due;
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(rowsQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = rowsResult.rows.map((row) => ({
    ...row,
    quantity: roundAmount(row.quantity),
    unit_price: roundAmount(row.unit_price),
    line_total: roundAmount(row.line_total),
    unit_cost: roundAmount(row.unit_cost),
    line_cogs_amount: roundAmount(row.line_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0),
    invoice_total_amount: roundAmount(row.invoice_total_amount),
    invoice_paid_amount: roundAmount(row.invoice_paid_amount),
    invoice_balance_due: roundAmount(row.invoice_balance_due)
  }));

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);

  return {
    summary: {
      total_lines: Number(summaryRow.total_lines || 0),
      total_products: Number(summaryRow.total_products || 0),
      total_customers: Number(summaryRow.total_customers || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      total_paid_amount: roundAmount(summaryRow.total_paid_amount),
      total_balance_due: roundAmount(summaryRow.total_balance_due),
      gross_margin_percent:
        totalSalesAmount > 0
          ? roundAmount((grossProfitAmount / totalSalesAmount) * 100)
          : 0
    },
    rows
  };
}

export async function getCategorySalesReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildCommercialAggregateFilters(filters);
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH base_sales AS (
      SELECT
        i.id AS invoice_id,
        i.invoice_date,
        i.customer_id,
        i.warehouse_id,
        p.id AS product_id,
        COALESCE(NULLIF(TRIM(p.category), ''), 'Non classe') AS category_label,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    )
    SELECT
      bs.category_label,
      COUNT(DISTINCT bs.product_id)::int AS products_count,
      COUNT(DISTINCT bs.invoice_id)::int AS invoices_count,
      COUNT(DISTINCT bs.customer_id)::int AS customers_count,
      COUNT(DISTINCT bs.warehouse_id)::int AS warehouses_count,
      MIN(bs.invoice_date) AS first_invoice_date,
      MAX(bs.invoice_date) AS last_invoice_date,
      COALESCE(SUM(bs.quantity), 0) AS total_quantity,
      COALESCE(SUM(bs.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(bs.line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(bs.gross_profit_amount), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(bs.line_total), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(bs.gross_profit_amount), 0) / COALESCE(SUM(bs.line_total), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM base_sales bs
    GROUP BY bs.category_label
    ORDER BY total_sales_amount DESC, category_label ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH base_sales AS (
      SELECT
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        p.id AS product_id,
        COALESCE(NULLIF(TRIM(p.category), ''), 'Non classe') AS category_label,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    )
    SELECT
      COUNT(DISTINCT category_label)::int AS total_categories,
      COUNT(DISTINCT product_id)::int AS total_products,
      COUNT(DISTINCT warehouse_id)::int AS total_warehouses,
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT invoice_id)::int AS total_invoices,
      COALESCE(SUM(quantity), 0) AS total_quantity,
      COALESCE(SUM(line_total), 0) AS total_sales_amount,
      COALESCE(SUM(line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount
    FROM base_sales;
  `;

  const [groupedResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = groupedResult.rows.map((row) => ({
    ...row,
    products_count: Number(row.products_count || 0),
    invoices_count: Number(row.invoices_count || 0),
    customers_count: Number(row.customers_count || 0),
    warehouses_count: Number(row.warehouses_count || 0),
    total_quantity: roundAmount(row.total_quantity),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0)
  }));

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);

  return {
    summary: {
      total_rows: rows.length,
      total_categories: Number(summaryRow.total_categories || 0),
      total_products: Number(summaryRow.total_products || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_customers: Number(summaryRow.total_customers || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      gross_margin_percent:
        totalSalesAmount > 0
          ? roundAmount((grossProfitAmount / totalSalesAmount) * 100)
          : 0
    },
    rows
  };
}

export async function getCommercialSalesReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildCommercialAggregateFilters(filters);
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_base AS (
      SELECT
        i.id AS invoice_id,
        i.invoice_date,
        i.customer_id,
        i.warehouse_id,
        c.business_name AS customer_name,
        c.city AS customer_city,
        COALESCE(NULLIF(TRIM(c.chain_name), ''), 'Sans chaine') AS chain_name,
        COALESCE(NULLIF(TRIM(c.sales_channel), ''), 'Canal non precise') AS sales_channel,
        COALESCE(
          NULLIF(TRIM(c.commercial_name), ''),
          NULLIF(TRIM(w.manager_name), ''),
          'Non attribue'
        ) AS commercial_name,
        CASE
          WHEN NULLIF(TRIM(c.commercial_name), '') IS NOT NULL THEN 'client'
          WHEN NULLIF(TRIM(w.manager_name), '') IS NOT NULL THEN 'depot_manager'
          ELSE 'non_attribue'
        END AS commercial_source,
        COALESCE(ic.total_quantity, 0) AS total_quantity,
        COALESCE(i.total_amount, 0) AS total_sales_amount,
        COALESCE(i.paid_amount, 0) AS total_collected_amount,
        COALESCE(i.balance_due, 0) AS total_receivables,
        COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
        COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0) AS net_sales_amount,
        (
          COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0)
          - COALESCE(ic.total_cogs_amount, 0)
        ) AS gross_profit_amount
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      ${whereClause}
    )
    SELECT
      ib.commercial_name,
      ib.commercial_source,
      COUNT(DISTINCT ib.customer_id)::int AS customers_count,
      COUNT(DISTINCT ib.warehouse_id)::int AS warehouses_count,
      COUNT(DISTINCT NULLIF(TRIM(ib.customer_city), ''))::int AS cities_count,
      COUNT(DISTINCT NULLIF(TRIM(ib.chain_name), ''))::int AS chains_count,
      COUNT(*)::int AS invoices_count,
      MIN(ib.invoice_date) AS first_invoice_date,
      MAX(ib.invoice_date) AS last_invoice_date,
      COALESCE(SUM(ib.total_quantity), 0) AS total_quantity,
      COALESCE(SUM(ib.total_sales_amount), 0) AS total_sales_amount,
      COALESCE(SUM(ib.total_collected_amount), 0) AS total_collected_amount,
      COALESCE(SUM(ib.total_receivables), 0) AS total_receivables,
      COALESCE(SUM(ib.total_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(ib.gross_profit_amount), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(ib.total_sales_amount), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(ib.total_collected_amount), 0) / COALESCE(SUM(ib.total_sales_amount), 0)) * 100,
            2
          )
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(ib.net_sales_amount), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(ib.gross_profit_amount), 0) / COALESCE(SUM(ib.net_sales_amount), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoice_base ib
    GROUP BY ib.commercial_name, ib.commercial_source
    ORDER BY total_sales_amount DESC, commercial_name ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_base AS (
      SELECT
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        c.city AS customer_city,
        COALESCE(
          NULLIF(TRIM(c.commercial_name), ''),
          NULLIF(TRIM(w.manager_name), ''),
          'Non attribue'
        ) AS commercial_name,
        COALESCE(ic.total_quantity, 0) AS total_quantity,
        COALESCE(i.total_amount, 0) AS total_sales_amount,
        COALESCE(i.paid_amount, 0) AS total_collected_amount,
        COALESCE(i.balance_due, 0) AS total_receivables,
        COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
        COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0) AS net_sales_amount,
        (
          COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0)
          - COALESCE(ic.total_cogs_amount, 0)
        ) AS gross_profit_amount
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN warehouses w ON w.id = i.warehouse_id
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      ${whereClause}
    )
    SELECT
      COUNT(DISTINCT commercial_name)::int AS total_commercials,
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT warehouse_id)::int AS total_warehouses,
      COUNT(DISTINCT NULLIF(TRIM(customer_city), ''))::int AS total_cities,
      COUNT(*)::int AS total_invoices,
      COALESCE(SUM(total_quantity), 0) AS total_quantity,
      COALESCE(SUM(total_sales_amount), 0) AS total_sales_amount,
      COALESCE(SUM(total_collected_amount), 0) AS total_collected_amount,
      COALESCE(SUM(total_receivables), 0) AS total_receivables,
      COALESCE(SUM(total_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount,
      COALESCE(SUM(net_sales_amount), 0) AS net_sales_amount
    FROM invoice_base;
  `;

  const [groupedResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = groupedResult.rows.map((row) => ({
    ...row,
    customers_count: Number(row.customers_count || 0),
    warehouses_count: Number(row.warehouses_count || 0),
    cities_count: Number(row.cities_count || 0),
    chains_count: Number(row.chains_count || 0),
    invoices_count: Number(row.invoices_count || 0),
    total_quantity: roundAmount(row.total_quantity),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_collected_amount: roundAmount(row.total_collected_amount),
    total_receivables: roundAmount(row.total_receivables),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    collection_rate_percent: Number(row.collection_rate_percent || 0),
    gross_margin_percent: Number(row.gross_margin_percent || 0)
  }));

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const totalCollectedAmount = Number(summaryRow.total_collected_amount || 0);
  const netSalesAmount = Number(summaryRow.net_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);

  return {
    summary: {
      total_rows: rows.length,
      total_commercials: Number(summaryRow.total_commercials || 0),
      total_customers: Number(summaryRow.total_customers || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_cities: Number(summaryRow.total_cities || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_collected_amount: roundAmount(totalCollectedAmount),
      total_receivables: roundAmount(summaryRow.total_receivables),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      collection_rate_percent:
        totalSalesAmount > 0
          ? roundAmount((totalCollectedAmount / totalSalesAmount) * 100)
          : 0,
      gross_margin_percent:
        netSalesAmount > 0
          ? roundAmount((grossProfitAmount / netSalesAmount) * 100)
          : 0
    },
    rows
  };
}

export async function getBreakEvenReport(filters = {}) {
  await ensureReportsSchema(pool);

  const startDate = filters.startDate || null;
  const endDate = filters.endDate || null;
  const values = [];

  const invoiceConditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const expenseConditions = [`1 = 1`];

  if (startDate) {
    values.push(startDate);
    invoiceConditions.push(`i.invoice_date >= $${values.length}`);
    expenseConditions.push(`e.expense_date >= $${values.length}`);
  }

  if (endDate) {
    values.push(endDate);
    invoiceConditions.push(`i.invoice_date <= $${values.length}`);
    expenseConditions.push(`e.expense_date <= $${values.length}`);
  }

  const invoiceWhereClause = `WHERE ${invoiceConditions.join(" AND ")}`;
  const expenseWhereClause = `WHERE ${expenseConditions.join(" AND ")}`;

  const summaryQuery = `
    WITH sales_base AS (
      SELECT
        i.id AS invoice_id,
        i.invoice_date,
        COALESCE(ii.line_total, 0) AS net_sales_amount,
        COALESCE(ii.quantity, 0) AS quantity,
        COALESCE(ii.quantity * COALESCE(p.cost_price, 0), 0) AS variable_cost_amount
      FROM invoices i
      INNER JOIN invoice_items ii ON ii.invoice_id = i.id
      INNER JOIN products p ON p.id = ii.product_id
      ${invoiceWhereClause}
    ),
    sales_summary AS (
      SELECT
        COUNT(DISTINCT invoice_id)::int AS total_invoices,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(net_sales_amount), 0) AS net_sales_amount,
        COALESCE(SUM(variable_cost_amount), 0) AS variable_cost_amount
      FROM sales_base
    ),
    expense_summary AS (
      SELECT
        COUNT(*)::int AS total_expenses,
        COALESCE(SUM(e.amount), 0) AS operating_expenses_amount
      FROM expenses e
      ${expenseWhereClause}
    )
    SELECT
      ss.total_invoices,
      ss.total_quantity,
      ss.net_sales_amount,
      ss.variable_cost_amount,
      (ss.net_sales_amount - ss.variable_cost_amount) AS contribution_margin_amount,
      es.total_expenses,
      es.operating_expenses_amount
    FROM sales_summary ss
    CROSS JOIN expense_summary es;
  `;

  const monthlyQuery = `
    WITH month_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', COALESCE($${values.length + 1}::date, CURRENT_DATE - INTERVAL '5 months')),
        DATE_TRUNC(
          'month',
          LEAST(COALESCE($${values.length + 2}::date, CURRENT_DATE), CURRENT_DATE)
        ),
        INTERVAL '1 month'
      )::date AS month_start
    ),
    sales_monthly AS (
      SELECT
        DATE_TRUNC('month', i.invoice_date)::date AS month_start,
        COUNT(DISTINCT i.id)::int AS invoices_count,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity,
        COALESCE(SUM(ii.line_total), 0) AS net_sales_amount,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS variable_cost_amount
      FROM invoices i
      INNER JOIN invoice_items ii ON ii.invoice_id = i.id
      INNER JOIN products p ON p.id = ii.product_id
      ${invoiceWhereClause}
      GROUP BY DATE_TRUNC('month', i.invoice_date)::date
    ),
    expense_monthly AS (
      SELECT
        DATE_TRUNC('month', e.expense_date)::date AS month_start,
        COUNT(*)::int AS expenses_count,
        COALESCE(SUM(e.amount), 0) AS operating_expenses_amount
      FROM expenses e
      ${expenseWhereClause}
      GROUP BY DATE_TRUNC('month', e.expense_date)::date
    )
    SELECT
      ms.month_start,
      TO_CHAR(ms.month_start, 'YYYY-MM') AS period_key,
      TO_CHAR(ms.month_start, 'Mon YYYY') AS period_label,
      COALESCE(sm.invoices_count, 0) AS invoices_count,
      COALESCE(sm.total_quantity, 0) AS total_quantity,
      COALESCE(sm.net_sales_amount, 0) AS net_sales_amount,
      COALESCE(sm.variable_cost_amount, 0) AS variable_cost_amount,
      COALESCE(em.expenses_count, 0) AS expenses_count,
      COALESCE(em.operating_expenses_amount, 0) AS operating_expenses_amount
    FROM month_series ms
    LEFT JOIN sales_monthly sm ON sm.month_start = ms.month_start
    LEFT JOIN expense_monthly em ON em.month_start = ms.month_start
    ORDER BY ms.month_start ASC;
  `;

  const monthlyQueryValues = [...values, startDate, endDate];

  const [summaryResult, monthlyResult] = await Promise.all([
    pool.query(summaryQuery, values),
    pool.query(monthlyQuery, monthlyQueryValues)
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const netSalesAmount = Number(summaryRow.net_sales_amount || 0);
  const variableCostAmount = Number(summaryRow.variable_cost_amount || 0);
  const contributionMarginAmount = netSalesAmount - variableCostAmount;
  const operatingExpensesAmount = Number(summaryRow.operating_expenses_amount || 0);
  const totalQuantity = Number(summaryRow.total_quantity || 0);
  const contributionMarginRatio =
    netSalesAmount > 0 ? contributionMarginAmount / netSalesAmount : 0;
  const breakEvenSalesAmount =
    contributionMarginRatio > 0
      ? operatingExpensesAmount / contributionMarginRatio
      : null;
  const averageSellingPricePerUnit =
    totalQuantity > 0 ? netSalesAmount / totalQuantity : 0;
  const averageContributionPerUnit =
    totalQuantity > 0 ? contributionMarginAmount / totalQuantity : 0;
  const breakEvenUnits =
    averageContributionPerUnit > 0
      ? operatingExpensesAmount / averageContributionPerUnit
      : null;
  const safetyMarginAmount =
    breakEvenSalesAmount === null ? null : netSalesAmount - breakEvenSalesAmount;
  const safetyMarginPercent =
    breakEvenSalesAmount !== null && netSalesAmount > 0
      ? (safetyMarginAmount / netSalesAmount) * 100
      : null;

  const rows = monthlyResult.rows.map((row) => {
    const rowNetSalesAmount = Number(row.net_sales_amount || 0);
    const rowVariableCostAmount = Number(row.variable_cost_amount || 0);
    const rowContributionMarginAmount =
      rowNetSalesAmount - rowVariableCostAmount;
    const rowOperatingExpensesAmount = Number(row.operating_expenses_amount || 0);
    const rowQuantity = Number(row.total_quantity || 0);
    const rowContributionMarginRatio =
      rowNetSalesAmount > 0
        ? rowContributionMarginAmount / rowNetSalesAmount
        : 0;
    const rowBreakEvenSalesAmount =
      rowContributionMarginRatio > 0
        ? rowOperatingExpensesAmount / rowContributionMarginRatio
        : null;
    const rowAverageContributionPerUnit =
      rowQuantity > 0 ? rowContributionMarginAmount / rowQuantity : 0;
    const rowBreakEvenUnits =
      rowAverageContributionPerUnit > 0
        ? rowOperatingExpensesAmount / rowAverageContributionPerUnit
        : null;
    const rowSafetyMarginAmount =
      rowBreakEvenSalesAmount === null
        ? null
        : rowNetSalesAmount - rowBreakEvenSalesAmount;
    const rowSafetyMarginPercent =
      rowBreakEvenSalesAmount !== null && rowNetSalesAmount > 0
        ? (rowSafetyMarginAmount / rowNetSalesAmount) * 100
        : null;

    return {
      ...row,
      invoices_count: Number(row.invoices_count || 0),
      expenses_count: Number(row.expenses_count || 0),
      total_quantity: roundAmount(rowQuantity),
      net_sales_amount: roundAmount(rowNetSalesAmount),
      variable_cost_amount: roundAmount(rowVariableCostAmount),
      contribution_margin_amount: roundAmount(rowContributionMarginAmount),
      contribution_margin_ratio: roundAmount(rowContributionMarginRatio * 100),
      operating_expenses_amount: roundAmount(rowOperatingExpensesAmount),
      break_even_sales_amount:
        rowBreakEvenSalesAmount === null
          ? null
          : roundAmount(rowBreakEvenSalesAmount),
      break_even_units:
        rowBreakEvenUnits === null ? null : roundAmount(rowBreakEvenUnits),
      safety_margin_amount:
        rowSafetyMarginAmount === null ? null : roundAmount(rowSafetyMarginAmount),
      safety_margin_percent:
        rowSafetyMarginPercent === null
          ? null
          : roundAmount(rowSafetyMarginPercent),
      status:
        rowBreakEvenSalesAmount === null
          ? "indetermine"
          : rowNetSalesAmount >= rowBreakEvenSalesAmount
          ? "au-dessus"
          : "en-dessous"
    };
  });

  return {
    summary: {
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_expenses: Number(summaryRow.total_expenses || 0),
      total_quantity: roundAmount(totalQuantity),
      net_sales_amount: roundAmount(netSalesAmount),
      variable_cost_amount: roundAmount(variableCostAmount),
      contribution_margin_amount: roundAmount(contributionMarginAmount),
      contribution_margin_ratio: roundAmount(contributionMarginRatio * 100),
      operating_expenses_amount: roundAmount(operatingExpensesAmount),
      break_even_sales_amount:
        breakEvenSalesAmount === null ? null : roundAmount(breakEvenSalesAmount),
      average_selling_price_per_unit: roundAmount(averageSellingPricePerUnit),
      average_contribution_per_unit: roundAmount(averageContributionPerUnit),
      break_even_units:
        breakEvenUnits === null ? null : roundAmount(breakEvenUnits),
      safety_margin_amount:
        safetyMarginAmount === null ? null : roundAmount(safetyMarginAmount),
      safety_margin_percent:
        safetyMarginPercent === null ? null : roundAmount(safetyMarginPercent),
      status:
        breakEvenSalesAmount === null
          ? "indetermine"
          : netSalesAmount >= breakEvenSalesAmount
          ? "au-dessus"
          : "en-dessous"
    },
    rows
  };
}

export async function getIncomeStatementReport(filters = {}) {
  await ensureReportsSchema(pool);

  const status =
    filters.status && String(filters.status).trim()
      ? String(filters.status).trim().toLowerCase()
      : "posted";

  const [incomeStatement, grossProfitResult] = await Promise.all([
    getIncomeStatement({
      start_date: filters.startDate || null,
      end_date: filters.endDate || null,
      status
    }),
    (async () => {
      const { whereClause, values } = buildInvoiceScopeFilters(filters, {
        invoice: "i",
        customer: "c"
      });

      return pool.query(
        `
        SELECT
          COALESCE(SUM(ii.line_total), 0) AS net_sales_amount,
          COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
        FROM invoice_items ii
        INNER JOIN invoices i ON i.id = ii.invoice_id
        INNER JOIN customers c ON c.id = i.customer_id
        INNER JOIN products p ON p.id = ii.product_id
        ${whereClause};
        `,
        values
      );
    })()
  ]);

  const grossProfitRow = grossProfitResult.rows[0] || {};
  const netSalesAmount = Number(grossProfitRow.net_sales_amount || 0);
  const totalCogsAmount = Number(grossProfitRow.total_cogs_amount || 0);
  const grossProfitAmount = netSalesAmount - totalCogsAmount;

  const revenueRows = (incomeStatement.revenues || []).map((row) => ({
    section: "Produits comptables",
    line_type: "account",
    account_number: row.account_number,
    account_name: row.account_name,
    account_type: row.account_type,
    total_debit: roundAmount(row.total_debit),
    total_credit: roundAmount(row.total_credit),
    net_amount: roundAmount(row.net_amount)
  }));
  const expenseRows = (incomeStatement.expenses || []).map((row) => ({
    section: "Charges comptables",
    line_type: "account",
    account_number: row.account_number,
    account_name: row.account_name,
    account_type: row.account_type,
    total_debit: roundAmount(row.total_debit),
    total_credit: roundAmount(row.total_credit),
    net_amount: roundAmount(row.net_amount)
  }));
  const totalRevenue = roundAmount(incomeStatement.totals?.total_revenue || 0);
  const totalExpense = roundAmount(incomeStatement.totals?.total_expense || 0);
  const netResult = roundAmount(incomeStatement.totals?.net_result || 0);

  const rows = [
    {
      section: "Indicateurs de gestion",
      line_type: "management",
      account_number: "",
      account_name: "Ventes nettes facturees",
      account_type: "income",
      total_debit: 0,
      total_credit: roundAmount(netSalesAmount),
      net_amount: roundAmount(netSalesAmount)
    },
    {
      section: "Indicateurs de gestion",
      line_type: "management",
      account_number: "",
      account_name: "Cout des ventes",
      account_type: "expense",
      total_debit: roundAmount(totalCogsAmount),
      total_credit: 0,
      net_amount: roundAmount(totalCogsAmount)
    },
    {
      section: "Indicateurs de gestion",
      line_type: "subtotal",
      account_number: "",
      account_name: "Marge brute commerciale",
      account_type: "result",
      total_debit: 0,
      total_credit: 0,
      net_amount: roundAmount(grossProfitAmount)
    },
    ...revenueRows,
    {
      section: "Produits comptables",
      line_type: "subtotal",
      account_number: "",
      account_name: "Total produits",
      account_type: "income",
      total_debit: 0,
      total_credit: totalRevenue,
      net_amount: totalRevenue
    },
    ...expenseRows,
    {
      section: "Charges comptables",
      line_type: "subtotal",
      account_number: "",
      account_name: "Total charges",
      account_type: "expense",
      total_debit: totalExpense,
      total_credit: 0,
      net_amount: totalExpense
    },
    {
      section: "Resultat",
      line_type: "total",
      account_number: "",
      account_name: netResult >= 0 ? "Benefice net" : "Perte nette",
      account_type: "result",
      total_debit: 0,
      total_credit: 0,
      net_amount: netResult
    }
  ];

  return {
    summary: {
      total_revenue: totalRevenue,
      total_expense: totalExpense,
      net_result: netResult,
      net_sales_amount: roundAmount(netSalesAmount),
      total_cogs_amount: roundAmount(totalCogsAmount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      gross_margin_percent:
        netSalesAmount > 0 ? roundAmount((grossProfitAmount / netSalesAmount) * 100) : 0,
      rows_count: rows.length
    },
    rows
  };
}

export async function getTreasuryStatementReport(filters = {}) {
  await ensureReportsSchema(pool);

  const values = [filters.startDate || null, filters.endDate || null];
  const movementsQuery = `
    SELECT *
    FROM (
      SELECT
        p.payment_date AS movement_date,
        1 AS flow_order,
        p.id AS movement_id,
        'Encaissement client' AS flow_type,
        COALESCE(
          NULLIF(TRIM(p.notes), ''),
          'Reglement facture ' || i.invoice_number
        ) AS designation,
        c.business_name AS third_party,
        c.business_name AS customer_name,
        w.name AS warehouse_name,
        i.invoice_number AS document_reference,
        p.reference AS payment_reference,
        p.payment_method,
        p.amount AS inflow,
        0::numeric AS outflow
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      LEFT JOIN warehouses w ON w.id = i.warehouse_id
      WHERE ($1::date IS NULL OR p.payment_date >= $1)
        AND ($2::date IS NULL OR p.payment_date <= $2)

      UNION ALL

      SELECT
        sp.payment_date AS movement_date,
        2 AS flow_order,
        sp.id AS movement_id,
        'Paiement fournisseur' AS flow_type,
        COALESCE(
          NULLIF(TRIM(sp.notes), ''),
          CASE
            WHEN pi.purchase_invoice_number IS NOT NULL
              THEN 'Reglement facture ' || pi.purchase_invoice_number
            ELSE 'Paiement fournisseur'
          END
        ) AS designation,
        s.business_name AS third_party,
        NULL::varchar AS customer_name,
        w.name AS warehouse_name,
        pi.purchase_invoice_number AS document_reference,
        sp.reference AS payment_reference,
        sp.payment_method,
        0::numeric AS inflow,
        sp.amount AS outflow
      FROM supplier_payments sp
      INNER JOIN suppliers s ON s.id = sp.supplier_id
      LEFT JOIN purchase_invoices pi ON pi.id = sp.purchase_invoice_id
      LEFT JOIN warehouses w ON w.id = pi.warehouse_id
      WHERE ($1::date IS NULL OR sp.payment_date >= $1)
        AND ($2::date IS NULL OR sp.payment_date <= $2)

      UNION ALL

      SELECT
        e.expense_date AS movement_date,
        3 AS flow_order,
        e.id AS movement_id,
        'Depense' AS flow_type,
        COALESCE(NULLIF(TRIM(e.description), ''), e.category) AS designation,
        COALESCE(s.business_name, NULLIF(TRIM(e.supplier), ''), 'Non renseigne') AS third_party,
        NULL::varchar AS customer_name,
        NULL::varchar AS warehouse_name,
        e.reference AS document_reference,
        e.reference AS payment_reference,
        e.payment_method,
        0::numeric AS inflow,
        e.amount AS outflow
      FROM expenses e
      LEFT JOIN suppliers s ON s.id = e.supplier_id
      WHERE ($1::date IS NULL OR e.expense_date >= $1)
        AND ($2::date IS NULL OR e.expense_date <= $2)
    ) movements
    ORDER BY movement_date ASC, flow_order ASC, movement_id ASC;
  `;

  const [movementsResult, forecast] = await Promise.all([
    pool.query(movementsQuery, values),
    getCashForecast(10),
  ]);

  let runningBalance = 0;
  const detailRows = movementsResult.rows.map((row) => {
    const inflow = Number(row.inflow || 0);
    const outflow = Number(row.outflow || 0);
    const netAmount = inflow - outflow;
    runningBalance += netAmount;

    return {
      ...row,
      inflow: roundAmount(inflow),
      outflow: roundAmount(outflow),
      net_amount: roundAmount(netAmount),
      running_balance: roundAmount(runningBalance),
      is_total: false
    };
  });

  const summary = detailRows.reduce(
    (acc, row) => {
      acc.total_receipts += Number(row.inflow || 0);
      acc.total_outflows += Number(row.outflow || 0);
      if (row.flow_type === "Paiement fournisseur") {
        acc.total_supplier_payments += Number(row.outflow || 0);
      }
      if (row.flow_type === "Depense") {
        acc.total_operating_expenses += Number(row.outflow || 0);
      }
      return acc;
    },
    {
      total_receipts: 0,
      total_supplier_payments: 0,
      total_operating_expenses: 0,
      total_outflows: 0,
    }
  );
  summary.net_cash_flow = summary.total_receipts - summary.total_outflows;
  const rows = [
    ...detailRows,
    {
      movement_date: null,
      flow_type: "TOTAL",
      designation: "Total des mouvements de tresorerie",
      third_party: "",
      customer_name: "",
      warehouse_name: "",
      document_reference: "",
      payment_reference: "",
      payment_method: "",
      inflow: roundAmount(summary.total_receipts),
      outflow: roundAmount(summary.total_outflows),
      net_amount: roundAmount(summary.net_cash_flow),
      running_balance: roundAmount(summary.net_cash_flow),
      is_total: true
    }
  ];

  return {
    summary: {
      movements_count: detailRows.length,
      total_receipts: roundAmount(summary.total_receipts),
      total_supplier_payments: roundAmount(summary.total_supplier_payments),
      total_operating_expenses: roundAmount(summary.total_operating_expenses),
      total_outflows: roundAmount(summary.total_outflows),
      net_cash_flow: roundAmount(summary.net_cash_flow),
      current_cash_base: roundAmount(forecast.summary?.current_cash_base || 0),
      cash_on_hand_base: roundAmount(forecast.summary?.cash_on_hand_base || 0),
      bank_base: roundAmount(forecast.summary?.bank_base || 0),
      mobile_money_base: roundAmount(forecast.summary?.mobile_money_base || 0),
      other_treasury_base: roundAmount(forecast.summary?.other_treasury_base || 0)
    },
    rows
  };
}

export async function getReceiptsJournalReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildPaymentJournalFilters(filters, {
    payment: "p",
    invoice: "i"
  });
  const finalValues = [...values, limit];

  const rowsQuery = `
    SELECT
      p.id,
      p.payment_date,
      p.amount,
      p.payment_method,
      p.reference,
      p.notes,
      p.received_by,
      p.accounting_status,
      p.accounting_entry_id,
      p.accounting_message,
      i.id AS invoice_id,
      i.invoice_number,
      c.id AS customer_id,
      c.business_name AS customer_name,
      c.city AS customer_city,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    ${whereClause}
    ORDER BY p.payment_date DESC, p.id DESC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    SELECT
      COUNT(*)::int AS total_payments,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COUNT(DISTINCT i.warehouse_id)::int AS total_warehouses,
      COALESCE(SUM(p.amount), 0) AS total_amount
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    ${whereClause};
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(rowsQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  return {
    summary: {
      total_payments: Number(summaryResult.rows[0]?.total_payments || 0),
      total_customers: Number(summaryResult.rows[0]?.total_customers || 0),
      total_warehouses: Number(summaryResult.rows[0]?.total_warehouses || 0),
      total_amount: roundAmount(summaryResult.rows[0]?.total_amount || 0)
    },
    rows: rowsResult.rows.map((row) => ({
      ...row,
      amount: roundAmount(row.amount)
    }))
  };
}

export async function getExpensesJournalReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildExpenseFilters(filters, {
    expense: "e"
  });
  const finalValues = [...values, limit];

  const rowsQuery = `
    SELECT
      e.id,
      e.expense_date,
      e.category,
      e.description,
      e.amount,
      e.payment_method,
      e.reference,
      e.notes,
      e.accounting_status,
      e.accounting_entry_id,
      e.accounting_message,
      e.supplier_id,
      COALESCE(s.business_name, e.supplier) AS supplier_name
    FROM expenses e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    ${whereClause}
    ORDER BY e.expense_date DESC, e.id DESC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    SELECT
      COUNT(*)::int AS total_expenses,
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(e.category), ''), 'non classe')))::int AS total_categories,
      COALESCE(SUM(e.amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE COALESCE(e.accounting_status, '') = 'posted')::int AS posted_count
    FROM expenses e
    ${whereClause};
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(rowsQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  return {
    summary: {
      total_expenses: Number(summaryResult.rows[0]?.total_expenses || 0),
      total_categories: Number(summaryResult.rows[0]?.total_categories || 0),
      total_amount: roundAmount(summaryResult.rows[0]?.total_amount || 0),
      posted_count: Number(summaryResult.rows[0]?.posted_count || 0)
    },
    rows: rowsResult.rows.map((row) => ({
      ...row,
      amount: roundAmount(row.amount)
    }))
  };
}

export async function getExpenseCategoryReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildExpenseFilters(filters, {
    expense: "e"
  });
  const finalValues = [...values, limit];

  const rowsQuery = `
    SELECT
      COALESCE(NULLIF(TRIM(e.category), ''), 'Non classe') AS category_label,
      COUNT(*)::int AS expenses_count,
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(e.payment_method), ''), 'non precise')))::int AS methods_count,
      COUNT(DISTINCT COALESCE(e.supplier_id, 0))::int AS suppliers_count,
      COALESCE(SUM(e.amount), 0) AS total_amount,
      COALESCE(AVG(e.amount), 0) AS average_amount,
      MIN(e.expense_date) AS first_expense_date,
      MAX(e.expense_date) AS last_expense_date
    FROM expenses e
    ${whereClause}
    GROUP BY COALESCE(NULLIF(TRIM(e.category), ''), 'Non classe')
    ORDER BY total_amount DESC, category_label ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    SELECT
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(e.category), ''), 'non classe')))::int AS total_categories,
      COUNT(*)::int AS total_expenses,
      COALESCE(SUM(e.amount), 0) AS total_amount
    FROM expenses e
    ${whereClause};
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(rowsQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const marketingAmount = rowsResult.rows.reduce((sum, row) => {
    const categoryLabel = String(row.category_label || "").trim().toLowerCase();
    return categoryLabel === "marketing" ? sum + Number(row.total_amount || 0) : sum;
  }, 0);

  return {
    summary: {
      total_categories: Number(summaryResult.rows[0]?.total_categories || 0),
      total_expenses: Number(summaryResult.rows[0]?.total_expenses || 0),
      total_amount: roundAmount(summaryResult.rows[0]?.total_amount || 0),
      marketing_amount: roundAmount(marketingAmount)
    },
    rows: rowsResult.rows.map((row) => ({
      ...row,
      expenses_count: Number(row.expenses_count || 0),
      methods_count: Number(row.methods_count || 0),
      suppliers_count: Number(row.suppliers_count || 0),
      total_amount: roundAmount(row.total_amount),
      average_amount: roundAmount(row.average_amount)
    }))
  };
}

export async function getMarginByCityReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildInvoiceScopeFilters(filters, {
    invoice: "i",
    customer: "c"
  });
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH city_sales AS (
      SELECT
        COALESCE(NULLIF(TRIM(c.city), ''), 'Ville non precise') AS customer_city,
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        COALESCE(i.total_amount, 0) AS invoice_total_amount,
        COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
        COALESCE(i.balance_due, 0) AS invoice_balance_due,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    ),
    invoice_financials AS (
      SELECT
        customer_city,
        invoice_id,
        MAX(invoice_paid_amount) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS paid_amount,
        MAX(invoice_balance_due) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS balance_due
      FROM city_sales
      GROUP BY customer_city, invoice_id
    ),
    city_financials AS (
      SELECT
        customer_city,
        COALESCE(SUM(paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(balance_due), 0) AS total_receivables
      FROM invoice_financials
      GROUP BY customer_city
    )
    SELECT
      cs.customer_city,
      COUNT(DISTINCT cs.customer_id)::int AS customers_count,
      COUNT(DISTINCT cs.warehouse_id)::int AS warehouses_count,
      COUNT(DISTINCT cs.invoice_id)::int AS invoices_count,
      COALESCE(SUM(cs.quantity), 0) AS total_quantity,
      COALESCE(SUM(cs.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(cs.line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(cs.gross_profit_amount), 0) AS gross_profit_amount,
      COALESCE(cf.total_collected_amount, 0) AS total_collected_amount,
      COALESCE(cf.total_receivables, 0) AS total_receivables
    FROM city_sales cs
    LEFT JOIN city_financials cf ON cf.customer_city = cs.customer_city
    GROUP BY cs.customer_city, cf.total_collected_amount, cf.total_receivables
    ORDER BY total_sales_amount DESC, customer_city ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH city_sales AS (
      SELECT
        COALESCE(NULLIF(TRIM(c.city), ''), 'Ville non precise') AS customer_city,
        i.id AS invoice_id,
        i.customer_id,
        i.warehouse_id,
        COALESCE(i.total_amount, 0) AS invoice_total_amount,
        COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
        COALESCE(i.balance_due, 0) AS invoice_balance_due,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    ),
    invoice_financials AS (
      SELECT
        invoice_id,
        MAX(customer_id) AS customer_id,
        MAX(warehouse_id) AS warehouse_id,
        MAX(invoice_paid_amount) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS paid_amount,
        MAX(invoice_balance_due) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS balance_due
      FROM city_sales
      GROUP BY invoice_id
    )
    SELECT
      COUNT(DISTINCT customer_city)::int AS total_cities,
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT warehouse_id)::int AS total_warehouses,
      COUNT(DISTINCT invoice_id)::int AS total_invoices,
      COALESCE(SUM(quantity), 0) AS total_quantity,
      COALESCE(SUM(line_total), 0) AS total_sales_amount,
      COALESCE(SUM(line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount,
      (SELECT COALESCE(SUM(paid_amount), 0) FROM invoice_financials) AS total_collected_amount,
      (SELECT COALESCE(SUM(balance_due), 0) FROM invoice_financials) AS total_receivables
    FROM city_sales;
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = rowsResult.rows.map((row) => {
    const totalSalesAmount = Number(row.total_sales_amount || 0);
    const grossProfitAmount = Number(row.gross_profit_amount || 0);
    const totalCollectedAmount = Number(row.total_collected_amount || 0);

    return {
      ...row,
      customers_count: Number(row.customers_count || 0),
      warehouses_count: Number(row.warehouses_count || 0),
      invoices_count: Number(row.invoices_count || 0),
      total_quantity: roundAmount(row.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      total_collected_amount: roundAmount(totalCollectedAmount),
      total_receivables: roundAmount(row.total_receivables),
      gross_margin_percent:
        totalSalesAmount > 0 ? roundAmount((grossProfitAmount / totalSalesAmount) * 100) : 0,
      collection_rate_percent:
        totalSalesAmount > 0 ? roundAmount((totalCollectedAmount / totalSalesAmount) * 100) : 0
    };
  });

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);
  const totalCollectedAmount = Number(summaryRow.total_collected_amount || 0);

  return {
    summary: {
      total_cities: Number(summaryRow.total_cities || 0),
      total_customers: Number(summaryRow.total_customers || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      total_collected_amount: roundAmount(totalCollectedAmount),
      total_receivables: roundAmount(summaryRow.total_receivables),
      gross_margin_percent:
        totalSalesAmount > 0 ? roundAmount((grossProfitAmount / totalSalesAmount) * 100) : 0,
      collection_rate_percent:
        totalSalesAmount > 0 ? roundAmount((totalCollectedAmount / totalSalesAmount) * 100) : 0
    },
    rows
  };
}

export async function getMarginByCustomerReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildInvoiceScopeFilters(filters, {
    invoice: "i",
    customer: "c"
  });
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH customer_sales AS (
      SELECT
        c.id AS customer_id,
        c.business_name AS customer_name,
        COALESCE(NULLIF(TRIM(c.city), ''), 'Ville non precise') AS customer_city,
        i.id AS invoice_id,
        i.warehouse_id,
        COALESCE(i.total_amount, 0) AS invoice_total_amount,
        COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
        COALESCE(i.balance_due, 0) AS invoice_balance_due,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    ),
    customer_financials AS (
      SELECT
        customer_id,
        COALESCE(SUM(paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(balance_due), 0) AS total_receivables
      FROM (
        SELECT
          customer_id,
          invoice_id,
          MAX(invoice_paid_amount) * CASE
            WHEN MAX(invoice_total_amount) > 0
              THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
            ELSE 0
          END AS paid_amount,
          MAX(invoice_balance_due) * CASE
            WHEN MAX(invoice_total_amount) > 0
              THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
            ELSE 0
          END AS balance_due
        FROM customer_sales
        GROUP BY customer_id, invoice_id
      ) invoice_financials
      GROUP BY customer_id
    )
    SELECT
      cs.customer_id,
      cs.customer_name,
      cs.customer_city,
      COUNT(DISTINCT cs.warehouse_id)::int AS warehouses_count,
      COUNT(DISTINCT cs.invoice_id)::int AS invoices_count,
      COALESCE(SUM(cs.quantity), 0) AS total_quantity,
      COALESCE(SUM(cs.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(cs.line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(cs.gross_profit_amount), 0) AS gross_profit_amount,
      COALESCE(cf.total_collected_amount, 0) AS total_collected_amount,
      COALESCE(cf.total_receivables, 0) AS total_receivables
    FROM customer_sales cs
    LEFT JOIN customer_financials cf ON cf.customer_id = cs.customer_id
    GROUP BY
      cs.customer_id,
      cs.customer_name,
      cs.customer_city,
      cf.total_collected_amount,
      cf.total_receivables
    ORDER BY total_sales_amount DESC, customer_name ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH customer_sales AS (
      SELECT
        c.id AS customer_id,
        i.id AS invoice_id,
        i.warehouse_id,
        COALESCE(i.total_amount, 0) AS invoice_total_amount,
        COALESCE(i.paid_amount, 0) AS invoice_paid_amount,
        COALESCE(i.balance_due, 0) AS invoice_balance_due,
        ii.quantity,
        ii.line_total,
        (ii.quantity * COALESCE(p.cost_price, 0)) AS line_cogs_amount,
        (ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN products p ON p.id = ii.product_id
      ${whereClause}
    ),
    invoice_financials AS (
      SELECT
        invoice_id,
        MAX(customer_id) AS customer_id,
        MAX(warehouse_id) AS warehouse_id,
        MAX(invoice_paid_amount) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS paid_amount,
        MAX(invoice_balance_due) * CASE
          WHEN MAX(invoice_total_amount) > 0
            THEN LEAST(SUM(line_total) / MAX(invoice_total_amount), 1)
          ELSE 0
        END AS balance_due
      FROM customer_sales
      GROUP BY invoice_id
    )
    SELECT
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT warehouse_id)::int AS total_warehouses,
      COUNT(DISTINCT invoice_id)::int AS total_invoices,
      COALESCE(SUM(quantity), 0) AS total_quantity,
      COALESCE(SUM(line_total), 0) AS total_sales_amount,
      COALESCE(SUM(line_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount,
      (SELECT COALESCE(SUM(paid_amount), 0) FROM invoice_financials) AS total_collected_amount,
      (SELECT COALESCE(SUM(balance_due), 0) FROM invoice_financials) AS total_receivables
    FROM customer_sales;
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = rowsResult.rows.map((row) => {
    const totalSalesAmount = Number(row.total_sales_amount || 0);
    const grossProfitAmount = Number(row.gross_profit_amount || 0);
    const totalCollectedAmount = Number(row.total_collected_amount || 0);

    return {
      ...row,
      warehouses_count: Number(row.warehouses_count || 0),
      invoices_count: Number(row.invoices_count || 0),
      total_quantity: roundAmount(row.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      total_collected_amount: roundAmount(totalCollectedAmount),
      total_receivables: roundAmount(row.total_receivables),
      gross_margin_percent:
        totalSalesAmount > 0 ? roundAmount((grossProfitAmount / totalSalesAmount) * 100) : 0,
      collection_rate_percent:
        totalSalesAmount > 0 ? roundAmount((totalCollectedAmount / totalSalesAmount) * 100) : 0
    };
  });

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const grossProfitAmount = Number(summaryRow.gross_profit_amount || 0);
  const totalCollectedAmount = Number(summaryRow.total_collected_amount || 0);

  return {
    summary: {
      total_customers: Number(summaryRow.total_customers || 0),
      total_warehouses: Number(summaryRow.total_warehouses || 0),
      total_invoices: Number(summaryRow.total_invoices || 0),
      total_quantity: roundAmount(summaryRow.total_quantity),
      total_sales_amount: roundAmount(totalSalesAmount),
      total_cogs_amount: roundAmount(summaryRow.total_cogs_amount),
      gross_profit_amount: roundAmount(grossProfitAmount),
      total_collected_amount: roundAmount(totalCollectedAmount),
      total_receivables: roundAmount(summaryRow.total_receivables),
      gross_margin_percent:
        totalSalesAmount > 0 ? roundAmount((grossProfitAmount / totalSalesAmount) * 100) : 0,
      collection_rate_percent:
        totalSalesAmount > 0 ? roundAmount((totalCollectedAmount / totalSalesAmount) * 100) : 0
    },
    rows
  };
}

export async function getBudgetVsActualReport(filters = {}) {
  await ensureReportsSchema(pool);

  let budgetId = Number(filters.budgetId || 0);

  if (!Number.isInteger(budgetId) || budgetId <= 0) {
    const budgets = await getAllBudgets();
    const fallbackBudget =
      budgets.find((budget) => Number(budget.is_active) === 1 || budget.is_active === true) ||
      budgets[0] ||
      null;

    if (!fallbackBudget) {
      return {
        summary: {
          total_planned: 0,
          total_actual: 0,
          total_variance: 0,
          attainment_percent: 0
        },
        rows: []
      };
    }

    budgetId = Number(fallbackBudget.id);
  }

  const comparison = await getBudgetVsActual(budgetId);

  if (!comparison) {
    return {
      summary: {
        total_planned: 0,
        total_actual: 0,
        total_variance: 0,
        attainment_percent: 0
      },
      rows: []
    };
  }

  return {
    summary: {
      budget_id: comparison.budget?.id || null,
      budget_name: comparison.budget?.name || null,
      fiscal_year: comparison.budget?.fiscal_year || null,
      warehouse_name: comparison.budget?.warehouse_name || null,
      total_planned: roundAmount(comparison.summary?.total_planned || 0),
      total_actual: roundAmount(comparison.summary?.total_actual || 0),
      total_variance: roundAmount(comparison.summary?.total_variance || 0),
      attainment_percent: roundAmount(comparison.summary?.attainment_percent || 0)
    },
    rows: (comparison.rows || []).map((row) => ({
      category_key: row.category_key,
      category_label: row.category_label,
      category_type: row.category_type,
      planned_total: roundAmount(row.planned_total),
      actual_total: roundAmount(row.actual_total),
      variance_total: roundAmount(row.variance_total),
      attainment_percent: roundAmount(row.attainment_percent)
    }))
  };
}

export async function getMarketingRatioReport(filters = {}) {
  await ensureReportsSchema(pool);

  const salesValues = [];
  const salesConditions = [`i.status IN ('issued', 'partial', 'paid')`];
  const expenseConditions = [
    `LOWER(COALESCE(e.category, '')) IN ('marketing', 'publicite', 'communication', 'promotion', 'promo', 'advertising')`
  ];

  if (filters.startDate) {
    salesValues.push(filters.startDate);
    salesConditions.push(`i.invoice_date >= $${salesValues.length}`);
    expenseConditions.push(`e.expense_date >= $${salesValues.length}`);
  }

  if (filters.endDate) {
    salesValues.push(filters.endDate);
    salesConditions.push(`i.invoice_date <= $${salesValues.length}`);
    expenseConditions.push(`e.expense_date <= $${salesValues.length}`);
  }

  const summaryQuery = `
    WITH sales_summary AS (
      SELECT COALESCE(SUM(i.total_amount), 0) AS total_sales_amount
      FROM invoices i
      WHERE ${salesConditions.join(" AND ")}
    ),
    marketing_summary AS (
      SELECT COALESCE(SUM(e.amount), 0) AS marketing_expenses_amount
      FROM expenses e
      WHERE ${expenseConditions.join(" AND ")}
    )
    SELECT
      ss.total_sales_amount,
      ms.marketing_expenses_amount
    FROM sales_summary ss
    CROSS JOIN marketing_summary ms;
  `;

  const monthlyQuery = `
    WITH month_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', COALESCE($${salesValues.length + 1}::date, CURRENT_DATE - INTERVAL '5 months')),
        DATE_TRUNC(
          'month',
          LEAST(
            COALESCE($${salesValues.length + 2}::date, CURRENT_DATE),
            CURRENT_DATE
          )
        ),
        INTERVAL '1 month'
      )::date AS month_start
    ),
    sales_monthly AS (
      SELECT
        DATE_TRUNC('month', i.invoice_date)::date AS month_start,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount
      FROM invoices i
      WHERE ${salesConditions.join(" AND ")}
      GROUP BY DATE_TRUNC('month', i.invoice_date)::date
    ),
    marketing_monthly AS (
      SELECT
        DATE_TRUNC('month', e.expense_date)::date AS month_start,
        COALESCE(SUM(e.amount), 0) AS marketing_expenses_amount
      FROM expenses e
      WHERE ${expenseConditions.join(" AND ")}
      GROUP BY DATE_TRUNC('month', e.expense_date)::date
    )
    SELECT
      ms.month_start,
      TO_CHAR(ms.month_start, 'YYYY-MM') AS period_key,
      TO_CHAR(ms.month_start, 'Mon YYYY') AS period_label,
      COALESCE(sm.total_sales_amount, 0) AS total_sales_amount,
      COALESCE(mm.marketing_expenses_amount, 0) AS marketing_expenses_amount
    FROM month_series ms
    LEFT JOIN sales_monthly sm ON sm.month_start = ms.month_start
    LEFT JOIN marketing_monthly mm ON mm.month_start = ms.month_start
    ORDER BY ms.month_start ASC;
  `;

  const [summaryResult, monthlyResult] = await Promise.all([
    pool.query(summaryQuery, salesValues),
    pool.query(monthlyQuery, [...salesValues, filters.startDate || null, filters.endDate || null])
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const totalSalesAmount = Number(summaryRow.total_sales_amount || 0);
  const marketingExpensesAmount = Number(summaryRow.marketing_expenses_amount || 0);

  return {
    summary: {
      total_sales_amount: roundAmount(totalSalesAmount),
      marketing_expenses_amount: roundAmount(marketingExpensesAmount),
      marketing_ratio_percent:
        totalSalesAmount > 0
          ? roundAmount((marketingExpensesAmount / totalSalesAmount) * 100)
          : 0
    },
    rows: monthlyResult.rows.map((row) => {
      const rowSales = Number(row.total_sales_amount || 0);
      const rowMarketing = Number(row.marketing_expenses_amount || 0);

      return {
        ...row,
        total_sales_amount: roundAmount(rowSales),
        marketing_expenses_amount: roundAmount(rowMarketing),
        marketing_ratio_percent:
          rowSales > 0 ? roundAmount((rowMarketing / rowSales) * 100) : 0
      };
    })
  };
}

export async function getCommissionDueReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildPaymentJournalFilters(filters, {
    payment: "p",
    invoice: "i"
  });
  const finalValues = [...values, limit];

  const groupedQuery = `
    WITH payment_base AS (
      SELECT
        p.id AS payment_id,
        p.payment_date,
        p.amount,
        p.payment_method,
        i.id AS invoice_id,
        i.invoice_number,
        i.customer_id,
        i.warehouse_id,
        c.business_name AS customer_name,
        c.customer_type,
        c.commercial_name
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      ${whereClause}
    ),
    commission_base AS (
      SELECT
        pb.payment_id,
        pb.payment_date,
        pb.amount,
        pb.payment_method,
        pb.invoice_id,
        pb.invoice_number,
        pb.customer_id,
        pb.warehouse_id,
        'commercial'::text AS beneficiary_type,
        TRIM(pb.commercial_name) AS beneficiary_name
      FROM payment_base pb
      WHERE NULLIF(TRIM(pb.commercial_name), '') IS NOT NULL

      UNION ALL

      SELECT
        pb.payment_id,
        pb.payment_date,
        pb.amount,
        pb.payment_method,
        pb.invoice_id,
        pb.invoice_number,
        pb.customer_id,
        pb.warehouse_id,
        'reseller'::text AS beneficiary_type,
        TRIM(pb.customer_name) AS beneficiary_name
      FROM payment_base pb
      WHERE LOWER(COALESCE(pb.customer_type, '')) IN ('distributor', 'wholesale')
    )
    SELECT
      cb.beneficiary_type,
      cb.beneficiary_name,
      COUNT(DISTINCT cb.customer_id)::int AS customers_count,
      COUNT(DISTINCT cb.invoice_id)::int AS invoices_count,
      COUNT(*)::int AS payments_count,
      MIN(cb.payment_date) AS first_payment_date,
      MAX(cb.payment_date) AS last_payment_date,
      COALESCE(SUM(cb.amount), 0) AS collections_amount,
      COALESCE(cp.commission_rate_percent, 0) AS commission_rate_percent,
      COALESCE(SUM(cb.amount), 0) * COALESCE(cp.commission_rate_percent, 0) / 100 AS commission_due_amount,
      CASE WHEN cp.id IS NULL THEN FALSE ELSE TRUE END AS profile_configured
    FROM commission_base cb
    LEFT JOIN commission_profiles cp
      ON cp.beneficiary_type = cb.beneficiary_type
      AND LOWER(TRIM(cp.beneficiary_name)) = LOWER(TRIM(cb.beneficiary_name))
      AND cp.is_active = TRUE
    GROUP BY
      cb.beneficiary_type,
      cb.beneficiary_name,
      cp.id,
      cp.commission_rate_percent
    ORDER BY commission_due_amount DESC, collections_amount DESC, beneficiary_name ASC
    LIMIT $${finalValues.length};
  `;

  const summaryQuery = `
    WITH payment_base AS (
      SELECT
        p.id AS payment_id,
        p.amount,
        i.id AS invoice_id,
        i.customer_id,
        c.customer_name,
        c.customer_type,
        c.commercial_name
      FROM (
        SELECT
          p.id,
          p.amount,
          p.invoice_id
        FROM payments p
        INNER JOIN invoices i ON i.id = p.invoice_id
        ${whereClause}
      ) p
      INNER JOIN invoices i ON i.id = p.invoice_id
      INNER JOIN (
        SELECT
          c.id,
          c.business_name AS customer_name,
          c.customer_type,
          c.commercial_name
        FROM customers c
      ) c ON c.id = i.customer_id
    ),
    commission_base AS (
      SELECT
        pb.payment_id,
        pb.amount,
        pb.invoice_id,
        pb.customer_id,
        'commercial'::text AS beneficiary_type,
        TRIM(pb.commercial_name) AS beneficiary_name
      FROM payment_base pb
      WHERE NULLIF(TRIM(pb.commercial_name), '') IS NOT NULL

      UNION ALL

      SELECT
        pb.payment_id,
        pb.amount,
        pb.invoice_id,
        pb.customer_id,
        'reseller'::text AS beneficiary_type,
        TRIM(pb.customer_name) AS beneficiary_name
      FROM payment_base pb
      WHERE LOWER(COALESCE(pb.customer_type, '')) IN ('distributor', 'wholesale')
    )
    SELECT
      COUNT(DISTINCT beneficiary_type || '::' || LOWER(beneficiary_name))::int AS total_beneficiaries,
      COUNT(DISTINCT customer_id)::int AS total_customers,
      COUNT(DISTINCT invoice_id)::int AS total_invoices,
      COUNT(*)::int AS total_payment_links,
      COALESCE(SUM(amount), 0) AS total_collections_amount
    FROM commission_base;
  `;

  const [rowsResult, summaryResult] = await Promise.all([
    pool.query(groupedQuery, finalValues),
    pool.query(summaryQuery, values)
  ]);

  const rows = rowsResult.rows.map((row) => ({
    ...row,
    customers_count: Number(row.customers_count || 0),
    invoices_count: Number(row.invoices_count || 0),
    payments_count: Number(row.payments_count || 0),
    collections_amount: roundAmount(row.collections_amount),
    commission_rate_percent: roundAmount(row.commission_rate_percent),
    commission_due_amount: roundAmount(row.commission_due_amount),
    profile_configured: Boolean(row.profile_configured)
  }));

  return {
    summary: {
      total_beneficiaries: Number(summaryResult.rows[0]?.total_beneficiaries || 0),
      total_customers: Number(summaryResult.rows[0]?.total_customers || 0),
      total_invoices: Number(summaryResult.rows[0]?.total_invoices || 0),
      total_payment_links: Number(summaryResult.rows[0]?.total_payment_links || 0),
      total_collections_amount: roundAmount(
        summaryResult.rows[0]?.total_collections_amount || 0
      ),
      total_commission_due_amount: roundAmount(
        rows.reduce((sum, row) => sum + Number(row.commission_due_amount || 0), 0)
      ),
      configured_profiles_count: rows.filter((row) => row.profile_configured).length
    },
    rows
  };
}

export async function getStockStateReport(filters = {}, limit = 500) {
  await ensureReportsSchema(pool);

  const { whereClause, values } = buildStockStateFilters(filters);
  const finalValues = [...values, limit];

  const query = `
    SELECT
      ws.id,
      ws.warehouse_id,
      ws.product_id,
      ws.quantity,
      ws.stock_form,
      ws.package_size,
      ws.package_unit,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      p.name AS product_name,
      p.sku,
      p.category,
      CASE
        WHEN ws.stock_form = 'bulk' THEN COALESCE(p.stock_unit, p.unit, 'unit')
        ELSE 'unit'
      END AS unit,
      COALESCE(p.alert_threshold, 0) AS alert_threshold,
      COALESCE(p.cost_price, 0) AS unit_cost,
      (ws.quantity * COALESCE(p.cost_price, 0)) AS stock_value,
      CASE
        WHEN ws.quantity <= COALESCE(p.alert_threshold, 0)
          THEN TRUE
        ELSE FALSE
      END AS is_below_alert
    FROM warehouse_stock ws
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    INNER JOIN products p ON p.id = ws.product_id
    ${whereClause}
    ORDER BY w.name ASC, p.name ASC, ws.id ASC
    LIMIT $${finalValues.length};
  `;

  const result = await pool.query(query, finalValues);
  const rows = result.rows.map((row) => ({
    ...row,
    quantity: roundAmount(row.quantity),
    alert_threshold: roundAmount(row.alert_threshold),
    unit_cost: roundAmount(row.unit_cost),
    stock_value: roundAmount(row.stock_value),
    is_below_alert: Boolean(row.is_below_alert)
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_rows += 1;
      acc.total_units += Number(row.quantity || 0);
      acc.total_stock_value += Number(row.stock_value || 0);

      if (row.is_below_alert) {
        acc.low_stock_rows += 1;
        acc.low_stock_units += Number(row.quantity || 0);
      }

      return acc;
    },
    {
      total_rows: 0,
      total_units: 0,
      total_stock_value: 0,
      low_stock_rows: 0,
      low_stock_units: 0
    }
  );

  return {
    summary: {
      total_rows: summary.total_rows,
      total_units: roundAmount(summary.total_units),
      total_stock_value: roundAmount(summary.total_stock_value),
      low_stock_rows: summary.low_stock_rows,
      low_stock_units: roundAmount(summary.low_stock_units)
    },
    rows
  };
}
