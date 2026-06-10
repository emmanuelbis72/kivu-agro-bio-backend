import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";
import { ensurePurchaseInvoicesSchema } from "./purchaseInvoice.model.js";
import {
  getBusinessRulesMap,
  getMonthlyRevenueTargets
} from "../services/ai/businessRules.service.js";
import { getAIForecasts } from "./ai/forecast.model.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatIsoDate(date) {
  return date.toISOString().split("T")[0];
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function computeMarginPercent(baseAmount, comparedAmount) {
  const base = Number(baseAmount || 0);

  if (base <= 0) {
    return 0;
  }

  return roundAmount((Number(comparedAmount || 0) / base) * 100);
}

function normalizeExecutivePeriodRow(row = {}) {
  const invoicedAmount = roundAmount(row.invoiced_amount);
  const netSalesAmount = roundAmount(row.net_sales_amount);
  const cogsAmount = roundAmount(row.cogs_amount);
  const grossProfitAmount = roundAmount(row.gross_profit_amount);
  const paymentsReceived = roundAmount(row.payments_received);
  const expensesAmount = roundAmount(row.expenses_amount);
  const netProfitEstimate = roundAmount(grossProfitAmount - expensesAmount);

  return {
    period_key: row.period_key,
    start_date: row.start_date,
    end_date: row.end_date,
    span_days: Number(row.span_days || 0),
    total_invoices: Number(row.total_invoices || 0),
    payments_count: Number(row.payments_count || 0),
    expenses_count: Number(row.expenses_count || 0),
    invoiced_amount: invoicedAmount,
    net_sales_amount: netSalesAmount,
    cogs_amount: cogsAmount,
    gross_profit_amount: grossProfitAmount,
    gross_margin_percent: computeMarginPercent(netSalesAmount, grossProfitAmount),
    payments_received: paymentsReceived,
    expenses_amount: expensesAmount,
    net_profit_estimate: netProfitEstimate,
    net_margin_percent: computeMarginPercent(netSalesAmount, netProfitEstimate)
  };
}

function buildExecutivePeriodComparison(currentPeriod = {}, referencePeriod = {}) {
  const currentInvoiced = Number(currentPeriod.invoiced_amount || 0);
  const referenceInvoiced = Number(referencePeriod.invoiced_amount || 0);
  const currentPayments = Number(currentPeriod.payments_received || 0);
  const referencePayments = Number(referencePeriod.payments_received || 0);
  const currentGrossProfit = Number(currentPeriod.gross_profit_amount || 0);
  const referenceGrossProfit = Number(referencePeriod.gross_profit_amount || 0);
  const currentNetProfit = Number(currentPeriod.net_profit_estimate || 0);
  const referenceNetProfit = Number(referencePeriod.net_profit_estimate || 0);

  return {
    current_period: currentPeriod,
    reference_period: referencePeriod,
    invoiced_delta: roundAmount(currentInvoiced - referenceInvoiced),
    invoiced_delta_percent: computeMarginPercent(
      referenceInvoiced,
      currentInvoiced - referenceInvoiced
    ),
    payments_delta: roundAmount(currentPayments - referencePayments),
    payments_delta_percent: computeMarginPercent(
      referencePayments,
      currentPayments - referencePayments
    ),
    gross_profit_delta: roundAmount(currentGrossProfit - referenceGrossProfit),
    gross_profit_delta_percent: computeMarginPercent(
      referenceGrossProfit,
      currentGrossProfit - referenceGrossProfit
    ),
    net_profit_delta: roundAmount(currentNetProfit - referenceNetProfit),
    net_profit_delta_percent: computeMarginPercent(
      referenceNetProfit,
      currentNetProfit - referenceNetProfit
    )
  };
}

function resolveMonthlyRevenueTargetForDate(targets = {}, referenceDate = new Date()) {
  const currentMinimum = Number(
    targets.current_minimum_monthly_received_payments_usd || 0
  );
  const fromJuly = Number(
    targets.target_from_july_2026_monthly_received_payments_usd ||
      currentMinimum
  );
  const byDecember = Number(
    targets.target_by_december_2026_monthly_received_payments_usd || fromJuly
  );

  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth() + 1;

  if (year > 2026 || (year === 2026 && month >= 12)) {
    return {
      label: "Objectif mensuel cible",
      value: byDecember
    };
  }

  if (year === 2026 && month >= 7) {
    return {
      label: "Objectif mensuel a partir de juillet 2026",
      value: fromJuly
    };
  }

  return {
    label: "Objectif mensuel minimum",
    value: currentMinimum
  };
}

function buildCustomerChainExpression(alias = "c") {
  return `
    COALESCE(
      NULLIF(TRIM(${alias}.chain_name), ''),
      CASE
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%GG MART%'
          OR UPPER(COALESCE(${alias}.business_name, '')) LIKE '%GGMART%'
          THEN 'GG MART'
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%CARREFOUR%'
          THEN 'CARREFOUR'
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%SWISSMART%'
          THEN 'SWISSMART'
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%CITY MARKET%'
          THEN 'CITY MARKET'
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%REGAL%'
          THEN 'REGAL'
        WHEN UPPER(COALESCE(${alias}.business_name, '')) LIKE '%SK %'
          OR UPPER(COALESCE(${alias}.business_name, '')) LIKE 'SK %'
          OR UPPER(COALESCE(${alias}.business_name, '')) LIKE '% SK'
          THEN 'SK'
        ELSE COALESCE(NULLIF(TRIM(${alias}.business_name), ''), 'Sans chaine')
      END
    )
  `;
}

function buildCustomerChannelExpression(alias = "c") {
  return `
    COALESCE(
      NULLIF(TRIM(${alias}.sales_channel), ''),
      CASE
        WHEN LOWER(COALESCE(${alias}.customer_type, '')) = 'supermarket'
          THEN 'Supermarches'
        WHEN LOWER(COALESCE(${alias}.customer_type, '')) = 'pharmacy'
          THEN 'Pharmacies'
        WHEN LOWER(COALESCE(${alias}.customer_type, '')) IN ('distributor', 'wholesale')
          THEN 'Distribution B2B'
        WHEN LOWER(COALESCE(${alias}.customer_type, '')) = 'retail'
          THEN 'Vente directe'
        ELSE 'Autres'
      END
    )
  `;
}

function normalizeCommercialAggregateRow(row = {}, totalSalesBase = 0) {
  const totalSalesAmount = roundAmount(row.total_sales_amount);
  const totalCollectedAmount = roundAmount(row.total_collected_amount);
  const totalReceivables = roundAmount(row.total_receivables);
  const totalCogsAmount = roundAmount(row.total_cogs_amount);
  const grossProfitAmount = roundAmount(row.gross_profit_amount);

  return {
    ...row,
    total_invoices:
      row.total_invoices === undefined ? undefined : Number(row.total_invoices || 0),
    total_customers:
      row.total_customers === undefined ? undefined : Number(row.total_customers || 0),
    total_sales_amount: totalSalesAmount,
    total_collected_amount:
      row.total_collected_amount === undefined ? undefined : totalCollectedAmount,
    total_receivables:
      row.total_receivables === undefined ? undefined : totalReceivables,
    total_cogs_amount:
      row.total_cogs_amount === undefined ? undefined : totalCogsAmount,
    gross_profit_amount:
      row.gross_profit_amount === undefined ? undefined : grossProfitAmount,
    collection_rate_percent:
      row.total_collected_amount === undefined
        ? undefined
        : row.collection_rate_percent === undefined || row.collection_rate_percent === null
        ? computeMarginPercent(totalSalesAmount, totalCollectedAmount)
        : Number(row.collection_rate_percent || 0),
    gross_margin_percent:
      row.gross_profit_amount === undefined
        ? undefined
        : row.gross_margin_percent === undefined || row.gross_margin_percent === null
        ? computeMarginPercent(totalSalesAmount, grossProfitAmount)
        : Number(row.gross_margin_percent || 0),
    sales_share_percent:
      row.total_sales_amount === undefined
        ? undefined
        : computeMarginPercent(totalSalesBase, totalSalesAmount)
  };
}

function normalizeHeatmapCellRow(row = {}) {
  const totalSalesAmount = roundAmount(row.total_sales_amount);
  const grossProfitAmount = roundAmount(row.gross_profit_amount);

  return {
    ...row,
    total_invoices: Number(row.total_invoices || 0),
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: totalSalesAmount,
    gross_profit_amount: grossProfitAmount,
    gross_margin_percent: Number(row.gross_margin_percent || 0),
    sales_share_in_product_percent: Number(
      row.sales_share_in_product_percent || 0
    ),
    sales_share_in_city_percent: Number(row.sales_share_in_city_percent || 0)
  };
}

function buildCommercialHeatmapFilterBindings(
  filters = {},
  invoiceAlias = "i",
  customerAlias = "ce",
  startIndex = 2
) {
  const values = [];
  const conditions = [];
  let parameterIndex = startIndex;

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${invoiceAlias}.warehouse_id = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.chainName) {
    values.push(filters.chainName);
    conditions.push(`${customerAlias}.chain_name_resolved = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.salesChannel) {
    values.push(filters.salesChannel);
    conditions.push(
      `${customerAlias}.sales_channel_resolved = $${parameterIndex}`
    );
    parameterIndex += 1;
  }

  return {
    values,
    clause: conditions.length ? `AND ${conditions.join(" AND ")}` : "",
    nextParameterIndex: parameterIndex
  };
}

function buildCollectionInvoiceFilterBindings(
  filters = {},
  aliases = {},
  startIndex = 1
) {
  const invoiceAlias = aliases.invoice || "i";
  const customerAlias = aliases.customer || "c";
  const values = [];
  const conditions = [`${invoiceAlias}.status IN ('issued', 'partial', 'paid')`];
  let parameterIndex = startIndex;

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${invoiceAlias}.invoice_date >= $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${invoiceAlias}.invoice_date <= $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${invoiceAlias}.warehouse_id = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`${invoiceAlias}.customer_id = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.customerCity) {
    values.push(filters.customerCity);
    conditions.push(
      `LOWER(COALESCE(${customerAlias}.city, '')) = LOWER($${parameterIndex})`
    );
    parameterIndex += 1;
  }

  return {
    values,
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    andClause:
      conditions.length > 1
        ? `AND ${conditions.slice(1).join(" AND ")}`
        : "",
    nextParameterIndex: parameterIndex
  };
}

function buildCollectionPaymentFilterBindings(
  filters = {},
  aliases = {},
  startIndex = 1
) {
  const paymentAlias = aliases.payment || "p";
  const invoiceAlias = aliases.invoice || "i";
  const customerAlias = aliases.customer || "c";
  const values = [];
  const conditions = ["1 = 1"];
  let parameterIndex = startIndex;

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${paymentAlias}.payment_date >= $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${paymentAlias}.payment_date <= $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${invoiceAlias}.warehouse_id = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.customerId) {
    values.push(filters.customerId);
    conditions.push(`${invoiceAlias}.customer_id = $${parameterIndex}`);
    parameterIndex += 1;
  }

  if (filters.customerCity) {
    values.push(filters.customerCity);
    conditions.push(
      `LOWER(COALESCE(${customerAlias}.city, '')) = LOWER($${parameterIndex})`
    );
    parameterIndex += 1;
  }

  return {
    values,
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    nextParameterIndex: parameterIndex
  };
}

function normalizePositiveWholeNumber(value, defaultValue, maxValue) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function normalizeOptionalPositiveWholeNumber(value, maxValue) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, maxValue);
}

function normalizeOptionalTextFilter(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

async function ensureDashboardSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS chain_name VARCHAR(150);
  `);
  await executor.query(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS sales_channel VARCHAR(80);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS stock_form VARCHAR(20) NOT NULL DEFAULT 'bulk';
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS package_size NUMERIC(14,2);
  `);
  await executor.query(`
    ALTER TABLE stock_movements
    ADD COLUMN IF NOT EXISTS package_unit VARCHAR(20);
  `);
}

function buildStockMovementFilters(filters = {}, alias = "sm") {
  const conditions = [];
  const values = [];

  if (filters.warehouseId) {
    values.push(filters.warehouseId);
    conditions.push(`${alias}.warehouse_id = $${values.length}`);
  }

  if (filters.productId) {
    values.push(filters.productId);
    conditions.push(`${alias}.product_id = $${values.length}`);
  }

  if (filters.stockForm) {
    values.push(filters.stockForm);
    conditions.push(`${alias}.stock_form = $${values.length}`);
  }

  if (filters.startDate) {
    values.push(filters.startDate);
    conditions.push(`${alias}.created_at::date >= $${values.length}`);
  }

  if (filters.endDate) {
    values.push(filters.endDate);
    conditions.push(`${alias}.created_at::date <= $${values.length}`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values
  };
}

export async function getGlobalStats() {
  const query = `
    WITH sales_base AS (
      SELECT
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS total_net_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM invoices i
      WHERE i.status IN ('issued', 'partial', 'paid')
    ),
    cogs_base AS (
      SELECT
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
    )
    SELECT
      (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE) AS total_products,
      (SELECT COUNT(*)::int FROM customers WHERE is_active = TRUE) AS total_customers,
      (SELECT COUNT(*)::int FROM warehouses) AS total_warehouses,
      (SELECT COUNT(*)::int FROM invoices) AS total_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'paid') AS paid_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'partial') AS partial_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'issued') AS unpaid_invoices,
      sales_base.total_sales_amount,
      sales_base.total_net_sales_amount,
      sales_base.total_collected_amount,
      sales_base.total_receivables,
      cogs_base.total_cogs_amount,
      (sales_base.total_net_sales_amount - cogs_base.total_cogs_amount) AS gross_profit_amount,
      CASE
        WHEN sales_base.total_net_sales_amount > 0
          THEN ROUND(
            ((sales_base.total_net_sales_amount - cogs_base.total_cogs_amount)
              / sales_base.total_net_sales_amount) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent,
      (SELECT COALESCE(SUM(amount), 0) FROM payments) AS total_payments_received,
      (SELECT COALESCE(SUM(quantity), 0) FROM warehouse_stock) AS total_units_in_stock
    FROM sales_base, cogs_base;
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

export async function getStockAlerts() {
  const query = `
    SELECT
      ws.id,
      ws.quantity,
      ws.warehouse_id,
      ws.product_id,
      p.name AS product_name,
      p.sku,
      p.alert_threshold,
      p.unit,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.quantity <= p.alert_threshold
    ORDER BY ws.quantity ASC, p.name ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getTopProducts(limit = 10) {
  const query = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      SUM(ii.quantity)::int AS total_quantity_sold,
      SUM(ii.line_total) AS total_sales_value,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
      COALESCE(SUM(ii.line_total), 0) - COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS gross_profit_amount
    FROM invoice_items ii
    INNER JOIN products p ON p.id = ii.product_id
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status IN ('issued', 'partial', 'paid')
    GROUP BY p.id, p.name, p.sku, p.category
    ORDER BY total_quantity_sold DESC, total_sales_value DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getTopCustomers(limit = 10) {
  const query = `
    SELECT
      c.id AS customer_id,
      c.business_name,
      c.city,
      COUNT(i.id)::int AS total_invoices,
      COALESCE(SUM(i.total_amount), 0) AS total_billed,
      COALESCE(SUM(i.paid_amount), 0) AS total_paid,
      COALESCE(SUM(i.balance_due), 0) AS total_balance_due
    FROM customers c
    INNER JOIN invoices i ON i.customer_id = c.id
    GROUP BY c.id, c.business_name, c.city
    ORDER BY total_billed DESC, total_paid DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getCustomerBalanceBoard() {
  const query = `
    WITH invoice_summary AS (
      SELECT
        i.customer_id,
        COUNT(i.id)::int AS invoices_count,
        COALESCE(SUM(i.total_amount), 0) AS invoiced_amount,
        COALESCE(SUM(i.balance_due), 0) AS balance_due_amount
      FROM invoices i
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY i.customer_id
    ),
    payment_summary AS (
      SELECT
        i.customer_id,
        COUNT(p.id)::int AS payments_count,
        COALESCE(SUM(p.amount), 0) AS paid_amount,
        MAX(p.payment_date) AS last_payment_date
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      GROUP BY i.customer_id
    )
    SELECT
      c.id AS customer_id,
      c.business_name,
      c.city,
      COALESCE(inv.invoices_count, 0) AS invoices_count,
      COALESCE(pay.payments_count, 0) AS payments_count,
      COALESCE(inv.invoiced_amount, 0) AS invoiced_amount,
      COALESCE(pay.paid_amount, 0) AS paid_amount,
      COALESCE(inv.balance_due_amount, 0) AS balance_due_amount,
      COALESCE(inv.invoiced_amount, 0) - COALESCE(pay.paid_amount, 0) AS balance_amount,
      pay.last_payment_date
    FROM customers c
    LEFT JOIN invoice_summary inv ON inv.customer_id = c.id
    LEFT JOIN payment_summary pay ON pay.customer_id = c.id
    WHERE COALESCE(inv.invoices_count, 0) > 0
       OR COALESCE(pay.payments_count, 0) > 0
    ORDER BY LOWER(TRIM(c.business_name)) ASC;
  `;

  const result = await pool.query(query);
  const rows = result.rows.map((row) => ({
    ...row,
    invoices_count: Number(row.invoices_count || 0),
    payments_count: Number(row.payments_count || 0),
    invoiced_amount: roundAmount(row.invoiced_amount),
    paid_amount: roundAmount(row.paid_amount),
    balance_due_amount: roundAmount(row.balance_due_amount),
    balance_amount: roundAmount(row.balance_amount)
  }));

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_customers += 1;
      acc.invoices_count += Number(row.invoices_count || 0);
      acc.payments_count += Number(row.payments_count || 0);
      acc.invoiced_amount += Number(row.invoiced_amount || 0);
      acc.paid_amount += Number(row.paid_amount || 0);
      acc.balance_due_amount += Number(row.balance_due_amount || 0);
      acc.balance_amount += Number(row.balance_amount || 0);
      return acc;
    },
    {
      total_customers: 0,
      invoices_count: 0,
      payments_count: 0,
      invoiced_amount: 0,
      paid_amount: 0,
      balance_due_amount: 0,
      balance_amount: 0
    }
  );

  return {
    rows,
    totals: {
      total_customers: Number(totals.total_customers || 0),
      invoices_count: Number(totals.invoices_count || 0),
      payments_count: Number(totals.payments_count || 0),
      invoiced_amount: roundAmount(totals.invoiced_amount),
      paid_amount: roundAmount(totals.paid_amount),
      balance_due_amount: roundAmount(totals.balance_due_amount),
      balance_amount: roundAmount(totals.balance_amount)
    }
  };
}

export async function getRecentInvoices(limit = 10) {
  const query = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.status,
      i.total_amount,
      i.tax_amount,
      i.paid_amount,
      i.balance_due,
      c.business_name AS customer_name,
      w.name AS warehouse_name,
      COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
      (COALESCE(i.total_amount, 0) - COALESCE(i.tax_amount, 0) - COALESCE(ic.total_cogs_amount, 0)) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    ORDER BY i.created_at DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getRecentPayments(limit = 10) {
  const query = `
    SELECT
      p.id,
      p.payment_date,
      p.amount,
      p.payment_method,
      p.reference,
      i.invoice_number,
      c.business_name AS customer_name
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    ORDER BY p.created_at DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getSalesOverview() {
  const query = `
    WITH period_series AS (
      SELECT
        month_start,
        half_index,
        CASE
          WHEN half_index = 1 THEN month_start
          ELSE month_start + INTERVAL '15 days'
        END::date AS period_start,
        CASE
          WHEN half_index = 1 THEN month_start + INTERVAL '14 days'
          ELSE (month_start + INTERVAL '1 month' - INTERVAL '1 day')
        END::date AS period_end
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_series(month_start)
      CROSS JOIN generate_series(1, 2) AS halves(half_index)
    ),
    invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END AS period_start,
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS total_net_sales,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected,
        COALESCE(SUM(i.balance_due), 0) AS total_due,
        COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs,
        COALESCE(
          SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
          0
        ) AS gross_profit
      FROM invoices i
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END
    )
    SELECT
      TO_CHAR(ps.month_start, 'YYYY-MM') || '-H' || ps.half_index AS period,
      TO_CHAR(ps.month_start, 'YYYY-MM') AS month_period,
      ps.half_index AS period_half,
      TO_CHAR(ps.period_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR(ps.period_end, 'YYYY-MM-DD') AS period_end,
      COALESCE(ip.total_invoices, 0) AS total_invoices,
      COALESCE(ip.total_sales, 0) AS total_sales,
      COALESCE(ip.total_net_sales, 0) AS total_net_sales,
      COALESCE(ip.total_collected, 0) AS total_collected,
      COALESCE(ip.total_due, 0) AS total_due,
      COALESCE(ip.total_cogs, 0) AS total_cogs,
      COALESCE(ip.gross_profit, 0) AS gross_profit
    FROM period_series ps
    LEFT JOIN invoice_periods ip ON ip.period_start = ps.period_start
    ORDER BY ps.period_start ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getExecutiveKpiSnapshot() {
  const query = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    periods AS (
      SELECT *
      FROM (
        VALUES
          ('day', CURRENT_DATE, CURRENT_DATE),
          ('week', DATE_TRUNC('week', CURRENT_DATE)::date, CURRENT_DATE),
          ('month', DATE_TRUNC('month', CURRENT_DATE)::date, CURRENT_DATE),
          (
            'previous_month_to_date',
            (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date,
            (
              (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month')::date
              + (CURRENT_DATE - DATE_TRUNC('month', CURRENT_DATE)::date) * INTERVAL '1 day'
            )::date
          ),
          (
            'same_month_last_year_to_date',
            (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 year')::date,
            (
              (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 year')::date
              + (CURRENT_DATE - DATE_TRUNC('month', CURRENT_DATE)::date) * INTERVAL '1 day'
            )::date
          ),
          (
            'current_month_full',
            DATE_TRUNC('month', CURRENT_DATE)::date,
            (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::date
          )
      ) AS period_values(period_key, start_date, end_date)
    )
    SELECT
      p.period_key,
      p.start_date,
      p.end_date,
      (p.end_date - p.start_date + 1)::int AS span_days,
      COALESCE((
        SELECT COUNT(*)::int
        FROM invoices i
        WHERE i.status IN ('issued', 'partial', 'paid')
          AND i.invoice_date BETWEEN p.start_date AND p.end_date
      ), 0) AS total_invoices,
      COALESCE((
        SELECT SUM(i.total_amount)
        FROM invoices i
        WHERE i.status IN ('issued', 'partial', 'paid')
          AND i.invoice_date BETWEEN p.start_date AND p.end_date
      ), 0) AS invoiced_amount,
      COALESCE((
        SELECT SUM(i.total_amount - COALESCE(i.tax_amount, 0))
        FROM invoices i
        WHERE i.status IN ('issued', 'partial', 'paid')
          AND i.invoice_date BETWEEN p.start_date AND p.end_date
      ), 0) AS net_sales_amount,
      COALESCE((
        SELECT SUM(COALESCE(ic.total_cogs_amount, 0))
        FROM invoices i
        LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
        WHERE i.status IN ('issued', 'partial', 'paid')
          AND i.invoice_date BETWEEN p.start_date AND p.end_date
      ), 0) AS cogs_amount,
      COALESCE((
        SELECT SUM(
          (i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)
        )
        FROM invoices i
        LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
        WHERE i.status IN ('issued', 'partial', 'paid')
          AND i.invoice_date BETWEEN p.start_date AND p.end_date
      ), 0) AS gross_profit_amount,
      COALESCE((
        SELECT COUNT(*)::int
        FROM payments py
        WHERE py.payment_date BETWEEN p.start_date AND p.end_date
      ), 0) AS payments_count,
      COALESCE((
        SELECT SUM(py.amount)
        FROM payments py
        WHERE py.payment_date BETWEEN p.start_date AND p.end_date
      ), 0) AS payments_received,
      COALESCE((
        SELECT COUNT(*)::int
        FROM expenses e
        WHERE e.expense_date BETWEEN p.start_date AND p.end_date
      ), 0) AS expenses_count,
      COALESCE((
        SELECT SUM(e.amount)
        FROM expenses e
        WHERE e.expense_date BETWEEN p.start_date AND p.end_date
      ), 0) AS expenses_amount
    FROM periods p
    ORDER BY
      CASE p.period_key
        WHEN 'day' THEN 1
        WHEN 'week' THEN 2
        WHEN 'month' THEN 3
        WHEN 'previous_month_to_date' THEN 4
        WHEN 'same_month_last_year_to_date' THEN 5
        WHEN 'current_month_full' THEN 6
        ELSE 99
      END;
  `;

  const [periodResult, globalStats, cashForecast, businessRules, forecasts] =
    await Promise.all([
      pool.query(query),
      getGlobalStats(),
      getCashForecast(6),
      getBusinessRulesMap(),
      getAIForecasts({ scenario_label: "baseline", limit: 20 })
    ]);

  const normalizedRows = periodResult.rows.map((row) =>
    normalizeExecutivePeriodRow(row)
  );
  const periods = Object.fromEntries(
    normalizedRows.map((row) => [row.period_key, row])
  );

  const currentMonth = periods.month || normalizeExecutivePeriodRow();
  const previousMonthToDate =
    periods.previous_month_to_date || normalizeExecutivePeriodRow();
  const sameMonthLastYear =
    periods.same_month_last_year_to_date || normalizeExecutivePeriodRow();
  const fullMonth = periods.current_month_full || normalizeExecutivePeriodRow();

  const referenceDate = new Date();
  const revenueTargets = getMonthlyRevenueTargets(businessRules);
  const monthlyTarget = resolveMonthlyRevenueTargetForDate(
    revenueTargets,
    referenceDate
  );
  const monthProgressRatio =
    Number(fullMonth.span_days || 0) > 0
      ? Number(currentMonth.span_days || 0) / Number(fullMonth.span_days || 1)
      : 0;

  const latestSalesForecast =
    forecasts.find((row) => row.forecast_domain === "sales") || null;
  const latestCashForecast =
    forecasts.find((row) => row.forecast_domain === "cash") || null;

  const monthlyRevenueTarget = roundAmount(monthlyTarget.value || 0);
  const expectedCollectedToDate = roundAmount(
    monthlyRevenueTarget * monthProgressRatio
  );
  const salesForecastFull = latestSalesForecast
    ? roundAmount(latestSalesForecast.projected_value)
    : null;
  const cashForecastFull = latestCashForecast
    ? roundAmount(latestCashForecast.projected_value)
    : null;
  const salesForecastToDate =
    salesForecastFull === null
      ? null
      : roundAmount(salesForecastFull * monthProgressRatio);
  const cashForecastToDate =
    cashForecastFull === null
      ? null
      : roundAmount(cashForecastFull * monthProgressRatio);

  return {
    as_of_date: new Date().toISOString(),
    current_cash_base: roundAmount(cashForecast?.summary?.current_cash_base || 0),
    cash_on_hand_base: roundAmount(cashForecast?.summary?.cash_on_hand_base || 0),
    bank_base: roundAmount(cashForecast?.summary?.bank_base || 0),
    mobile_money_base: roundAmount(
      cashForecast?.summary?.mobile_money_base || 0
    ),
    other_treasury_base: roundAmount(
      cashForecast?.summary?.other_treasury_base || 0
    ),
    open_receivables: roundAmount(globalStats?.total_receivables || 0),
    open_payables: roundAmount(cashForecast?.summary?.open_payables || 0),
    periods: {
      day: periods.day || null,
      week: periods.week || null,
      month: currentMonth
    },
    comparisons: {
      month_vs_previous_month_to_date: buildExecutivePeriodComparison(
        currentMonth,
        previousMonthToDate
      ),
      month_vs_same_period_last_year: buildExecutivePeriodComparison(
        currentMonth,
        sameMonthLastYear
      )
    },
    targets: {
      monthly_revenue_target: monthlyRevenueTarget,
      target_label: monthlyTarget.label,
      month_progress_ratio: roundAmount(monthProgressRatio),
      month_progress_percent: roundAmount(monthProgressRatio * 100),
      expected_collected_to_date: expectedCollectedToDate,
      actual_collected_to_date: roundAmount(currentMonth.payments_received),
      collected_gap_to_target: roundAmount(
        Number(currentMonth.payments_received || 0) - expectedCollectedToDate
      ),
      collected_achievement_percent: computeMarginPercent(
        expectedCollectedToDate,
        currentMonth.payments_received
      )
    },
    forecasts: {
      sales_30d_forecast: salesForecastFull,
      sales_30d_forecast_to_date: salesForecastToDate,
      actual_sales_to_date: roundAmount(currentMonth.invoiced_amount),
      sales_gap_to_forecast:
        salesForecastToDate === null
          ? null
          : roundAmount(
              Number(currentMonth.invoiced_amount || 0) - salesForecastToDate
            ),
      cash_30d_forecast: cashForecastFull,
      cash_30d_forecast_to_date: cashForecastToDate,
      actual_cash_to_date: roundAmount(currentMonth.payments_received),
      cash_gap_to_forecast:
        cashForecastToDate === null
          ? null
          : roundAmount(
              Number(currentMonth.payments_received || 0) - cashForecastToDate
            )
    }
  };
}

export async function getExecutiveComparisonTimeline(months = 6) {
  const safeMonths = Math.min(Math.max(Number(months || 6), 1), 6);
  const query = `
    WITH period_series AS (
      SELECT
        month_start,
        half_index,
        CASE
          WHEN half_index = 1 THEN month_start
          ELSE month_start + INTERVAL '15 days'
        END::date AS period_start,
        CASE
          WHEN half_index = 1 THEN month_start + INTERVAL '14 days'
          ELSE (month_start + INTERVAL '1 month' - INTERVAL '1 day')
        END::date AS period_end
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month'),
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_series(month_start)
      CROSS JOIN generate_series(1, 2) AS halves(half_index)
    ),
    invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END AS period_start,
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS invoiced_amount,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS net_sales_amount,
        COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS cogs_amount,
        COALESCE(
          SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
          0
        ) AS gross_profit_amount
      FROM invoices i
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END
    ),
    payment_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM p.payment_date) <= 15
            THEN DATE_TRUNC('month', p.payment_date)::date
          ELSE (DATE_TRUNC('month', p.payment_date) + INTERVAL '15 days')::date
        END AS period_start,
        COALESCE(SUM(p.amount), 0) AS payments_received
      FROM payments p
      WHERE p.payment_date >= DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM p.payment_date) <= 15
            THEN DATE_TRUNC('month', p.payment_date)::date
          ELSE (DATE_TRUNC('month', p.payment_date) + INTERVAL '15 days')::date
        END
    ),
    expense_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM e.expense_date) <= 15
            THEN DATE_TRUNC('month', e.expense_date)::date
          ELSE (DATE_TRUNC('month', e.expense_date) + INTERVAL '15 days')::date
        END AS period_start,
        COALESCE(SUM(e.amount), 0) AS expenses_amount
      FROM expenses e
      WHERE e.expense_date >= DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM e.expense_date) <= 15
            THEN DATE_TRUNC('month', e.expense_date)::date
          ELSE (DATE_TRUNC('month', e.expense_date) + INTERVAL '15 days')::date
        END
    )
    SELECT
      TO_CHAR(ps.month_start, 'YYYY-MM') || '-H' || ps.half_index AS period,
      TO_CHAR(ps.month_start, 'YYYY-MM') AS month_period,
      ps.half_index AS period_half,
      TO_CHAR(ps.period_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR(ps.period_end, 'YYYY-MM-DD') AS period_end,
      COALESCE(im.total_invoices, 0) AS total_invoices,
      COALESCE(im.invoiced_amount, 0) AS invoiced_amount,
      COALESCE(pm.payments_received, 0) AS payments_received,
      COALESCE(em.expenses_amount, 0) AS expenses_amount,
      COALESCE(im.gross_profit_amount, 0) AS gross_profit_amount,
      COALESCE(im.net_sales_amount, 0) AS net_sales_amount,
      COALESCE(im.cogs_amount, 0) AS cogs_amount
    FROM period_series ps
    LEFT JOIN invoice_periods im ON im.period_start = ps.period_start
    LEFT JOIN payment_periods pm ON pm.period_start = ps.period_start
    LEFT JOIN expense_periods em ON em.period_start = ps.period_start
    ORDER BY ps.period_start ASC;
  `;

  const result = await pool.query(query, [safeMonths]);
  return result.rows.map((row) => ({
    ...row,
    total_invoices: Number(row.total_invoices || 0),
    invoiced_amount: roundAmount(row.invoiced_amount),
    payments_received: roundAmount(row.payments_received),
    expenses_amount: roundAmount(row.expenses_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    net_sales_amount: roundAmount(row.net_sales_amount),
    cogs_amount: roundAmount(row.cogs_amount)
  }));
}

export async function getSalesByWarehouse() {
  const query = `
    WITH warehouse_invoice_cogs AS (
      SELECT
        i.warehouse_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY i.warehouse_id
    )
    SELECT
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city,
      COUNT(i.id)::int AS total_invoices,
      COALESCE(SUM(i.total_amount), 0) AS total_sales,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected,
      COALESCE(SUM(i.balance_due), 0) AS total_due,
      COALESCE(wic.total_cogs, 0) AS total_cogs,
      COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) - COALESCE(wic.total_cogs, 0) AS gross_profit
    FROM warehouses w
    LEFT JOIN invoices i ON i.warehouse_id = w.id
    LEFT JOIN warehouse_invoice_cogs wic ON wic.warehouse_id = w.id
    GROUP BY w.id, w.name, w.city, wic.total_cogs
    ORDER BY total_sales DESC, warehouse_name ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getProductCategoryStats() {
  const query = `
    SELECT
      COALESCE(category, 'Non classé') AS category,
      COUNT(*)::int AS total_products
    FROM products
    GROUP BY COALESCE(category, 'Non classé')
    ORDER BY total_products DESC, category ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getLowRotationProducts(limit = 10) {
  const query = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(SUM(ii.quantity), 0)::int AS total_quantity_sold
    FROM products p
    LEFT JOIN invoice_items ii ON ii.product_id = p.id
    LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status IN ('issued', 'partial', 'paid')
    GROUP BY p.id, p.name, p.sku, p.category
    ORDER BY total_quantity_sold ASC, p.name ASC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getAccountingGlobalStats() {
  const query = `
    SELECT
      (SELECT COUNT(*)::int FROM accounts WHERE is_active = TRUE) AS total_accounts,
      (SELECT COUNT(*)::int FROM journal_entries) AS total_entries,
      (SELECT COUNT(*)::int FROM journal_entries WHERE status = 'posted') AS posted_entries,
      (SELECT COUNT(*)::int FROM journal_entries WHERE status = 'draft') AS draft_entries,
      (SELECT COALESCE(SUM(jel.debit), 0) FROM journal_entry_lines jel
        INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE je.status = 'posted') AS total_posted_debit,
      (SELECT COALESCE(SUM(jel.credit), 0) FROM journal_entry_lines jel
        INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE je.status = 'posted') AS total_posted_credit;
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

export async function getAccountingHealthSnapshot() {
  await ensurePurchaseInvoicesSchema(pool);

  const [
    documentStatusResult,
    journalStatusResult,
    imbalancedResult,
    orphanResult,
    paymentMethodMappingsResult,
    paymentMethodCoverageResult,
    expenseCategoryUsageResult
  ] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM payments WHERE accounting_entry_id IS NULL OR COALESCE(accounting_status, '') <> 'posted') AS payments_to_fix,
        (SELECT COUNT(*)::int FROM supplier_payments WHERE accounting_entry_id IS NULL OR COALESCE(accounting_status, '') <> 'posted') AS supplier_payments_to_fix,
        (SELECT COUNT(*)::int FROM invoices WHERE COALESCE(status, 'issued') <> 'cancelled' AND (accounting_entry_id IS NULL OR COALESCE(accounting_status, '') <> 'posted')) AS invoices_to_fix,
        (SELECT COUNT(*)::int FROM purchase_invoices WHERE COALESCE(status, 'issued') <> 'cancelled' AND (accounting_entry_id IS NULL OR COALESCE(accounting_status, '') <> 'posted')) AS purchase_invoices_to_fix,
        (SELECT COUNT(*)::int FROM expenses WHERE accounting_entry_id IS NULL OR COALESCE(accounting_status, '') <> 'posted') AS expenses_to_fix;
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_entries,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_entries,
        COUNT(*) FILTER (WHERE status = 'posted')::int AS posted_entries,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_entries
      FROM journal_entries;
    `),
    pool.query(`
      SELECT COUNT(*)::int AS imbalanced_entries
      FROM (
        SELECT je.id
        FROM journal_entries je
        INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        WHERE je.status = 'posted'
        GROUP BY je.id
        HAVING ROUND(COALESCE(SUM(jel.debit), 0)::numeric, 2)
             <> ROUND(COALESCE(SUM(jel.credit), 0)::numeric, 2)
      ) AS imbalanced;
    `),
    pool.query(`
      SELECT
        (
          (SELECT COUNT(*) FROM payments p LEFT JOIN journal_entries je ON je.id = p.accounting_entry_id WHERE p.accounting_entry_id IS NOT NULL AND je.id IS NULL) +
          (SELECT COUNT(*) FROM supplier_payments sp LEFT JOIN journal_entries je ON je.id = sp.accounting_entry_id WHERE sp.accounting_entry_id IS NOT NULL AND je.id IS NULL) +
          (SELECT COUNT(*) FROM invoices i LEFT JOIN journal_entries je ON je.id = i.accounting_entry_id WHERE i.accounting_entry_id IS NOT NULL AND je.id IS NULL) +
          (SELECT COUNT(*) FROM purchase_invoices pi LEFT JOIN journal_entries je ON je.id = pi.accounting_entry_id WHERE pi.accounting_entry_id IS NOT NULL AND je.id IS NULL) +
          (SELECT COUNT(*) FROM expenses e LEFT JOIN journal_entries je ON je.id = e.accounting_entry_id WHERE e.accounting_entry_id IS NOT NULL AND je.id IS NULL)
        )::int AS orphan_links;
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS payment_method_mappings_count,
        ARRAY(
          SELECT expected_method
          FROM unnest(ARRAY['cash', 'mobile_money', 'bank_transfer', 'card']) AS expected_method
          WHERE NOT EXISTS (
            SELECT 1
            FROM payment_method_accounts pma
            WHERE pma.payment_method = expected_method
          )
        ) AS missing_payment_methods
      FROM payment_method_accounts;
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS expense_category_mappings_count,
        ARRAY(
          SELECT DISTINCT e.category
          FROM expenses e
          WHERE COALESCE(TRIM(e.category), '') <> ''
            AND NOT EXISTS (
              SELECT 1
              FROM expense_category_accounts eca
              WHERE LOWER(TRIM(eca.category)) = LOWER(TRIM(e.category))
            )
          ORDER BY e.category
        ) AS unmapped_expense_categories
      FROM expense_category_accounts;
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS configured_expense_categories
      FROM expense_category_accounts;
    `)
  ]);

  const documentStatus = documentStatusResult.rows[0] || {};
  const journalStatus = journalStatusResult.rows[0] || {};
  const imbalanced = imbalancedResult.rows[0] || {};
  const orphan = orphanResult.rows[0] || {};
  const paymentCoverage = paymentMethodMappingsResult.rows[0] || {};
  const expenseCategoryCoverage = paymentMethodCoverageResult.rows[0] || {};
  const expenseCategoryCount = expenseCategoryUsageResult.rows[0] || {};

  const issues = [];

  const totals = {
    payments_to_fix: Number(documentStatus.payments_to_fix || 0),
    supplier_payments_to_fix: Number(documentStatus.supplier_payments_to_fix || 0),
    invoices_to_fix: Number(documentStatus.invoices_to_fix || 0),
    purchase_invoices_to_fix: Number(documentStatus.purchase_invoices_to_fix || 0),
    expenses_to_fix: Number(documentStatus.expenses_to_fix || 0),
    draft_entries: Number(journalStatus.draft_entries || 0),
    imbalanced_entries: Number(imbalanced.imbalanced_entries || 0),
    orphan_links: Number(orphan.orphan_links || 0),
    payment_method_mappings_count: Number(
      paymentCoverage.payment_method_mappings_count || 0
    ),
    configured_expense_categories: Number(
      expenseCategoryCount.configured_expense_categories || 0
    )
  };

  if (totals.payments_to_fix > 0) {
    issues.push(`${totals.payments_to_fix} paiement(s) a recomptabiliser`);
  }
  if (totals.supplier_payments_to_fix > 0) {
    issues.push(
      `${totals.supplier_payments_to_fix} paiement(s) fournisseur a recomptabiliser`
    );
  }
  if (totals.invoices_to_fix > 0) {
    issues.push(`${totals.invoices_to_fix} facture(s) client non postee(s)`);
  }
  if (totals.purchase_invoices_to_fix > 0) {
    issues.push(
      `${totals.purchase_invoices_to_fix} facture(s) fournisseur non postee(s)`
    );
  }
  if (totals.expenses_to_fix > 0) {
    issues.push(`${totals.expenses_to_fix} depense(s) non postee(s)`);
  }
  if (totals.draft_entries > 0) {
    issues.push(`${totals.draft_entries} ecriture(s) en brouillon`);
  }
  if (totals.imbalanced_entries > 0) {
    issues.push(`${totals.imbalanced_entries} ecriture(s) desequilibree(s)`);
  }
  if (totals.orphan_links > 0) {
    issues.push(`${totals.orphan_links} lien(s) comptables orphelin(s)`);
  }

  const missingPaymentMethods = Array.isArray(
    paymentCoverage.missing_payment_methods
  )
    ? paymentCoverage.missing_payment_methods.filter(Boolean)
    : [];
  const unmappedExpenseCategories = Array.isArray(
    expenseCategoryCoverage.unmapped_expense_categories
  )
    ? expenseCategoryCoverage.unmapped_expense_categories.filter(Boolean)
    : [];

  if (missingPaymentMethods.length > 0) {
    issues.push(
      `modes de paiement sans mapping: ${missingPaymentMethods.join(", ")}`
    );
  }
  if (unmappedExpenseCategories.length > 0) {
    issues.push(
      `categories de depense sans mapping: ${unmappedExpenseCategories.join(", ")}`
    );
  }

  const status =
    totals.imbalanced_entries > 0 ||
    totals.orphan_links > 0 ||
    missingPaymentMethods.length > 0
      ? "critical"
      : issues.length > 0
      ? "attention"
      : "healthy";

  return {
    status,
    issues,
    totals: {
      ...totals,
      total_entries: Number(journalStatus.total_entries || 0),
      posted_entries: Number(journalStatus.posted_entries || 0),
      cancelled_entries: Number(journalStatus.cancelled_entries || 0)
    },
    coverage: {
      payment_method_mappings_count: totals.payment_method_mappings_count,
      missing_payment_methods: missingPaymentMethods,
      configured_expense_categories: totals.configured_expense_categories,
      unmapped_expense_categories: unmappedExpenseCategories
    }
  };
}

export async function getCashForecast(detailLimit = 10) {
  await ensurePurchaseInvoicesSchema(pool);

  const actualCashCte = `
    actual_cash_flows AS (
      SELECT
        method_group,
        COALESCE(SUM(customer_receipts), 0) AS customer_receipts,
        COALESCE(SUM(supplier_payments), 0) AS supplier_payments,
        COALESCE(SUM(expenses), 0) AS expenses
      FROM (
        SELECT
          CASE
            WHEN LOWER(TRIM(COALESCE(p.payment_method, 'unknown'))) IN ('cash', 'mobile_money', 'bank_transfer')
              THEN LOWER(TRIM(COALESCE(p.payment_method, 'unknown')))
            ELSE 'other'
          END AS method_group,
          SUM(COALESCE(p.amount, 0)) AS customer_receipts,
          0::numeric AS supplier_payments,
          0::numeric AS expenses
        FROM payments p
        GROUP BY 1

        UNION ALL

        SELECT
          CASE
            WHEN LOWER(TRIM(COALESCE(sp.payment_method, 'unknown'))) IN ('cash', 'mobile_money', 'bank_transfer')
              THEN LOWER(TRIM(COALESCE(sp.payment_method, 'unknown')))
            ELSE 'other'
          END AS method_group,
          0::numeric AS customer_receipts,
          SUM(COALESCE(sp.amount, 0)) AS supplier_payments,
          0::numeric AS expenses
        FROM supplier_payments sp
        GROUP BY 1

        UNION ALL

        SELECT
          CASE
            WHEN LOWER(TRIM(COALESCE(e.payment_method, 'unknown'))) IN ('cash', 'mobile_money', 'bank_transfer')
              THEN LOWER(TRIM(COALESCE(e.payment_method, 'unknown')))
            ELSE 'other'
          END AS method_group,
          0::numeric AS customer_receipts,
          0::numeric AS supplier_payments,
          SUM(COALESCE(e.amount, 0)) AS expenses
        FROM expenses e
        GROUP BY 1
      ) cash_flows
      GROUP BY method_group
    ),
    actual_cash AS (
      SELECT
        COALESCE(SUM(customer_receipts), 0) AS total_customer_receipts,
        COALESCE(SUM(supplier_payments), 0) AS total_supplier_payments,
        COALESCE(SUM(expenses), 0) AS total_expenses,
        COALESCE(SUM(customer_receipts - supplier_payments - expenses) FILTER (
          WHERE method_group = 'cash'
        ), 0) AS cash_on_hand_base,
        COALESCE(SUM(customer_receipts - supplier_payments - expenses) FILTER (
          WHERE method_group = 'bank_transfer'
        ), 0) AS bank_base,
        COALESCE(SUM(customer_receipts - supplier_payments - expenses) FILTER (
          WHERE method_group = 'mobile_money'
        ), 0) AS mobile_money_base,
        COALESCE(SUM(customer_receipts - supplier_payments - expenses) FILTER (
          WHERE method_group = 'other'
        ), 0) AS other_treasury_base,
        COALESCE(SUM(customer_receipts - supplier_payments - expenses), 0) AS current_cash_base
      FROM actual_cash_flows
    )
  `;

  const summaryQuery = `
    WITH receivables AS (
      SELECT
        COUNT(*) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
        )::int AS open_receivable_invoices,
        COALESCE(SUM(i.balance_due) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
        ), 0) AS open_receivables,
        COUNT(*) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date IS NOT NULL
            AND i.due_date < CURRENT_DATE
        )::int AS overdue_receivable_invoices,
        COALESCE(SUM(i.balance_due) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date IS NOT NULL
            AND i.due_date < CURRENT_DATE
        ), 0) AS overdue_receivables,
        COUNT(*) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date IS NULL
        )::int AS undated_receivable_invoices,
        COALESCE(SUM(i.balance_due) FILTER (
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date IS NULL
        ), 0) AS undated_receivables
      FROM invoices i
    ),
    payables AS (
      SELECT
        COUNT(*) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
        )::int AS open_payable_invoices,
        COALESCE(SUM(pi.balance_due) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
        ), 0) AS open_payables,
        COUNT(*) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
            AND pi.due_date IS NOT NULL
            AND pi.due_date < CURRENT_DATE
        )::int AS overdue_payable_invoices,
        COALESCE(SUM(pi.balance_due) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
            AND pi.due_date IS NOT NULL
            AND pi.due_date < CURRENT_DATE
        ), 0) AS overdue_payables,
        COUNT(*) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
            AND pi.due_date IS NULL
        )::int AS undated_payable_invoices,
        COALESCE(SUM(pi.balance_due) FILTER (
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
            AND pi.due_date IS NULL
        ), 0) AS undated_payables
      FROM purchase_invoices pi
    ),
    ${actualCashCte}
    SELECT
      r.open_receivable_invoices,
      r.open_receivables,
      r.overdue_receivable_invoices,
      r.overdue_receivables,
      r.undated_receivable_invoices,
      r.undated_receivables,
      p.open_payable_invoices,
      p.open_payables,
      p.overdue_payable_invoices,
      p.overdue_payables,
      p.undated_payable_invoices,
      p.undated_payables,
      a.total_customer_receipts,
      a.total_supplier_payments,
      a.total_expenses,
      a.cash_on_hand_base,
      a.bank_base,
      a.mobile_money_base,
      a.other_treasury_base,
      a.current_cash_base
    FROM receivables r
    CROSS JOIN payables p
    CROSS JOIN actual_cash a;
  `;

  const horizonsQuery = `
    WITH
    ${actualCashCte},
    horizons(days) AS (
      VALUES (7), (30), (60)
    )
    SELECT
      h.days AS horizon_days,
      (
        SELECT COUNT(*)::int
        FROM invoices i
        WHERE i.status IN ('issued', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
          AND i.due_date IS NOT NULL
          AND i.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
      ) AS due_receivables_count,
      COALESCE((
        SELECT SUM(i.balance_due)
        FROM invoices i
        WHERE i.status IN ('issued', 'partial')
          AND COALESCE(i.balance_due, 0) > 0
          AND i.due_date IS NOT NULL
          AND i.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
      ), 0) AS expected_inflows,
      (
        SELECT COUNT(*)::int
        FROM purchase_invoices pi
        WHERE pi.status IN ('issued', 'partial')
          AND COALESCE(pi.balance_due, 0) > 0
          AND pi.due_date IS NOT NULL
          AND pi.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
      ) AS due_payables_count,
      COALESCE((
        SELECT SUM(pi.balance_due)
        FROM purchase_invoices pi
        WHERE pi.status IN ('issued', 'partial')
          AND COALESCE(pi.balance_due, 0) > 0
          AND pi.due_date IS NOT NULL
          AND pi.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
      ), 0) AS expected_outflows,
      (
        (
          a.total_customer_receipts
          - a.total_supplier_payments
          - a.total_expenses
        )
        + COALESCE((
          SELECT SUM(i.balance_due)
          FROM invoices i
          WHERE i.status IN ('issued', 'partial')
            AND COALESCE(i.balance_due, 0) > 0
            AND i.due_date IS NOT NULL
            AND i.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
        ), 0)
        - COALESCE((
          SELECT SUM(pi.balance_due)
          FROM purchase_invoices pi
          WHERE pi.status IN ('issued', 'partial')
            AND COALESCE(pi.balance_due, 0) > 0
            AND pi.due_date IS NOT NULL
            AND pi.due_date <= CURRENT_DATE + (h.days * INTERVAL '1 day')
        ), 0)
      ) AS projected_balance
    FROM horizons h
    CROSS JOIN actual_cash a
    ORDER BY h.days ASC;
  `;

  const receivablesQuery = `
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      i.status,
      i.total_amount,
      i.paid_amount,
      i.balance_due,
      c.business_name AS customer_name,
      c.city AS customer_city,
      (i.due_date - CURRENT_DATE) AS days_from_today
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    WHERE i.status IN ('issued', 'partial')
      AND COALESCE(i.balance_due, 0) > 0
      AND i.due_date IS NOT NULL
    ORDER BY i.due_date ASC, i.balance_due DESC, i.invoice_date ASC
    LIMIT $1;
  `;

  const payablesQuery = `
    SELECT
      pi.id,
      pi.purchase_invoice_number,
      pi.invoice_date,
      pi.due_date,
      pi.status,
      pi.total_amount,
      pi.paid_amount,
      pi.balance_due,
      s.business_name AS supplier_name,
      s.city AS supplier_city,
      (pi.due_date - CURRENT_DATE) AS days_from_today
    FROM purchase_invoices pi
    INNER JOIN suppliers s ON s.id = pi.supplier_id
    WHERE pi.status IN ('issued', 'partial')
      AND COALESCE(pi.balance_due, 0) > 0
      AND pi.due_date IS NOT NULL
    ORDER BY pi.due_date ASC, pi.balance_due DESC, pi.invoice_date ASC
    LIMIT $1;
  `;

  const [summaryResult, horizonsResult, receivablesResult, payablesResult] =
    await Promise.all([
      pool.query(summaryQuery),
      pool.query(horizonsQuery),
      pool.query(receivablesQuery, [detailLimit]),
      pool.query(payablesQuery, [detailLimit])
    ]);

  const summary = summaryResult.rows[0] || {};

  return {
    summary: {
      open_receivable_invoices: Number(summary.open_receivable_invoices || 0),
      open_receivables: roundAmount(summary.open_receivables),
      overdue_receivable_invoices: Number(
        summary.overdue_receivable_invoices || 0
      ),
      overdue_receivables: roundAmount(summary.overdue_receivables),
      undated_receivable_invoices: Number(
        summary.undated_receivable_invoices || 0
      ),
      undated_receivables: roundAmount(summary.undated_receivables),
      open_payable_invoices: Number(summary.open_payable_invoices || 0),
      open_payables: roundAmount(summary.open_payables),
      overdue_payable_invoices: Number(summary.overdue_payable_invoices || 0),
      overdue_payables: roundAmount(summary.overdue_payables),
      undated_payable_invoices: Number(summary.undated_payable_invoices || 0),
      undated_payables: roundAmount(summary.undated_payables),
      total_customer_receipts: roundAmount(summary.total_customer_receipts),
      total_supplier_payments: roundAmount(summary.total_supplier_payments),
      total_expenses: roundAmount(summary.total_expenses),
      cash_on_hand_base: roundAmount(summary.cash_on_hand_base),
      bank_base: roundAmount(summary.bank_base),
      mobile_money_base: roundAmount(summary.mobile_money_base),
      other_treasury_base: roundAmount(summary.other_treasury_base),
      current_cash_base: roundAmount(summary.current_cash_base)
    },
    horizons: horizonsResult.rows.map((row) => ({
      horizon_days: Number(row.horizon_days || 0),
      due_receivables_count: Number(row.due_receivables_count || 0),
      expected_inflows: roundAmount(row.expected_inflows),
      due_payables_count: Number(row.due_payables_count || 0),
      expected_outflows: roundAmount(row.expected_outflows),
      projected_balance: roundAmount(row.projected_balance)
    })),
    receivables_due_soon: receivablesResult.rows.map((row) => ({
      ...row,
      total_amount: roundAmount(row.total_amount),
      paid_amount: roundAmount(row.paid_amount),
      balance_due: roundAmount(row.balance_due),
      days_from_today: Number(row.days_from_today || 0)
    })),
    payables_due_soon: payablesResult.rows.map((row) => ({
      ...row,
      total_amount: roundAmount(row.total_amount),
      paid_amount: roundAmount(row.paid_amount),
      balance_due: roundAmount(row.balance_due),
      days_from_today: Number(row.days_from_today || 0)
    }))
  };
}

export async function getCommercialDashboard(
  periodDays = 365,
  topLimit = 10,
  heatmapFilters = {}
) {
  await ensureDashboardSchema(pool);
  const resolvedPeriodDays = normalizePositiveWholeNumber(periodDays, 365, 3650);
  const resolvedTopLimit = normalizePositiveWholeNumber(topLimit, 10, 50);
  const defaultHeatmapDimensionLimit = Math.min(
    Math.max(Number(resolvedTopLimit || 10), 6),
    12
  );
  const normalizedHeatmapFilters = {
    days: normalizePositiveWholeNumber(
      heatmapFilters.days,
      resolvedPeriodDays,
      3650
    ),
    warehouseId: normalizeOptionalPositiveWholeNumber(
      heatmapFilters.warehouseId,
      1000000
    ),
    chainName: normalizeOptionalTextFilter(heatmapFilters.chainName),
    salesChannel: normalizeOptionalTextFilter(heatmapFilters.salesChannel),
    topProducts: normalizePositiveWholeNumber(
      heatmapFilters.topProducts,
      defaultHeatmapDimensionLimit,
      20
    ),
    topCities: normalizePositiveWholeNumber(
      heatmapFilters.topCities,
      defaultHeatmapDimensionLimit,
      20
    )
  };
  const heatmapBestPairLimit = Math.min(
    Math.max(
      Math.max(
        Number(normalizedHeatmapFilters.topProducts || 0),
        Number(normalizedHeatmapFilters.topCities || 0)
      ),
      6
    ),
    15
  );
  const heatmapFilterBindings = buildCommercialHeatmapFilterBindings(
    normalizedHeatmapFilters,
    "i",
    "ce",
    2
  );
  const heatmapTopProductsParameter = heatmapFilterBindings.nextParameterIndex;
  const heatmapTopCitiesParameter = heatmapTopProductsParameter + 1;
  const heatmapBestPairsLimitParameter = heatmapFilterBindings.nextParameterIndex;

  const invoiceCogsCte = `
    invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
  `;

  const customersEnrichedCte = `
    customers_enriched AS (
      SELECT
        c.*,
        ${buildCustomerChainExpression("c")} AS chain_name_resolved,
        ${buildCustomerChannelExpression("c")} AS sales_channel_resolved
      FROM customers c
    )
  `;

  const summaryQuery = `
    WITH
      ${invoiceCogsCte},
      ${customersEnrichedCte},
    filtered_invoices AS (
      SELECT
        i.id,
        i.customer_id,
        i.warehouse_id,
        i.invoice_date,
        i.total_amount,
        COALESCE(i.tax_amount, 0) AS tax_amount,
        COALESCE(i.paid_amount, 0) AS paid_amount,
        COALESCE(i.balance_due, 0) AS balance_due,
        ce.city AS customer_city,
        ce.chain_name_resolved AS chain_name,
        ce.sales_channel_resolved AS sales_channel,
        COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount
      FROM invoices i
      INNER JOIN customers_enriched ce ON ce.id = i.customer_id
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    )
    SELECT
      COUNT(*)::int AS total_invoices,
      COUNT(DISTINCT customer_id)::int AS active_customers,
      COUNT(DISTINCT warehouse_id)::int AS active_warehouses,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(customer_city), ''), 'Non renseignee'))::int AS active_cities,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(chain_name), ''), 'Sans chaine'))::int AS active_chains,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(sales_channel), ''), 'Autres'))::int AS active_channels,
      COALESCE(SUM(total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(total_amount - tax_amount), 0) AS total_net_sales_amount,
      COALESCE(SUM(paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(balance_due), 0) AS total_receivables,
      COALESCE(SUM(total_cogs_amount), 0) AS total_cogs_amount,
      COALESCE(SUM((total_amount - tax_amount) - total_cogs_amount), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(total_amount - tax_amount), 0) > 0
          THEN ROUND(
            (COALESCE(SUM((total_amount - tax_amount) - total_cogs_amount), 0)
              / COALESCE(SUM(total_amount - tax_amount), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM filtered_invoices;
  `;

  const monthlyTrendQuery = `
    WITH period_series AS (
      SELECT
        month_start,
        half_index,
        CASE
          WHEN half_index = 1 THEN month_start
          ELSE month_start + INTERVAL '15 days'
        END::date AS period_start,
        CASE
          WHEN half_index = 1 THEN month_start + INTERVAL '14 days'
          ELSE (month_start + INTERVAL '1 month' - INTERVAL '1 day')
        END::date AS period_end
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_series(month_start)
      CROSS JOIN generate_series(1, 2) AS halves(half_index)
    ),
    invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END AS period_start,
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS total_net_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables,
        COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
        COALESCE(
          SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
          0
        ) AS gross_profit_amount
      FROM invoices i
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END
    )
    SELECT
      TO_CHAR(ps.month_start, 'YYYY-MM') || '-H' || ps.half_index AS period,
      TO_CHAR(ps.month_start, 'YYYY-MM') AS month_period,
      ps.half_index AS period_half,
      TO_CHAR(ps.period_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR(ps.period_end, 'YYYY-MM-DD') AS period_end,
      COALESCE(ip.total_invoices, 0) AS total_invoices,
      COALESCE(ip.total_sales_amount, 0) AS total_sales_amount,
      COALESCE(ip.total_net_sales_amount, 0) AS total_net_sales_amount,
      COALESCE(ip.total_collected_amount, 0) AS total_collected_amount,
      COALESCE(ip.total_receivables, 0) AS total_receivables,
      COALESCE(ip.total_cogs_amount, 0) AS total_cogs_amount,
      COALESCE(ip.gross_profit_amount, 0) AS gross_profit_amount
    FROM period_series ps
    LEFT JOIN invoice_periods ip ON ip.period_start = ps.period_start
    ORDER BY ps.period_start ASC;
  `;

  const salesByCityQuery = `
    WITH ${invoiceCogsCte}
    SELECT
      COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee')
    ORDER BY total_sales_amount DESC, city ASC
    LIMIT $2;
  `;

  const salesByWarehouseQuery = `
    WITH ${invoiceCogsCte}
    SELECT
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM warehouses w
    LEFT JOIN invoices i
      ON i.warehouse_id = w.id
      AND i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    GROUP BY w.id, w.name, w.city
    ORDER BY total_sales_amount DESC, warehouse_name ASC;
  `;

  const salesByChainQuery = `
    WITH
      ${invoiceCogsCte},
      ${customersEnrichedCte}
    SELECT
      ce.chain_name_resolved AS chain_name,
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM customers_enriched ce
    INNER JOIN invoices i ON i.customer_id = ce.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY ce.chain_name_resolved
    ORDER BY total_sales_amount DESC, chain_name ASC
    LIMIT $2;
  `;

  const salesByChannelQuery = `
    WITH
      ${invoiceCogsCte},
      ${customersEnrichedCte}
    SELECT
      ce.sales_channel_resolved AS sales_channel,
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM customers_enriched ce
    INNER JOIN invoices i ON i.customer_id = ce.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY ce.sales_channel_resolved
    ORDER BY total_sales_amount DESC, sales_channel ASC
    LIMIT $2;
  `;

  const salesByCustomerQuery = `
    WITH
      ${invoiceCogsCte},
      ${customersEnrichedCte}
    SELECT
      ce.id AS customer_id,
      ce.business_name,
      ce.city,
      ce.customer_type,
      ce.chain_name_resolved AS chain_name,
      ce.sales_channel_resolved AS sales_channel,
      COUNT(i.id)::int AS total_invoices,
      MAX(i.invoice_date) AS last_invoice_date,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM customers_enriched ce
    INNER JOIN invoices i ON i.customer_id = ce.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY
      ce.id,
      ce.business_name,
      ce.city,
      ce.customer_type,
      ce.chain_name_resolved,
      ce.sales_channel_resolved
    ORDER BY total_sales_amount DESC, total_collected_amount DESC
    LIMIT $2;
  `;

  const salesByProductQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
      COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
      COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(ii.line_total), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0)
              / COALESCE(SUM(ii.line_total), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    INNER JOIN products p ON p.id = ii.product_id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY p.id, p.name, p.sku, p.category
    ORDER BY total_sales_amount DESC, total_quantity_sold DESC
    LIMIT $2;
  `;

  const productCityHeatmapQuery = `
    WITH
      ${customersEnrichedCte},
    product_city_base AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(NULLIF(TRIM(ce.city), ''), 'Non renseignee') AS city,
        COUNT(DISTINCT i.id)::int AS total_invoices,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      INNER JOIN customers_enriched ce ON ce.id = i.customer_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
        ${heatmapFilterBindings.clause}
      GROUP BY
        p.id,
        p.name,
        p.category,
        COALESCE(NULLIF(TRIM(ce.city), ''), 'Non renseignee')
    ),
    top_products AS (
      SELECT
        product_id,
        product_name,
        category,
        COALESCE(SUM(total_sales_amount), 0) AS total_sales_amount,
        COALESCE(SUM(total_quantity_sold), 0) AS total_quantity_sold,
        COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount
      FROM product_city_base
      GROUP BY product_id, product_name, category
      ORDER BY total_sales_amount DESC, product_name ASC
      LIMIT $${heatmapTopProductsParameter}
    ),
    top_cities AS (
      SELECT
        city,
        COALESCE(SUM(total_sales_amount), 0) AS total_sales_amount,
        COALESCE(SUM(total_quantity_sold), 0) AS total_quantity_sold,
        COALESCE(SUM(gross_profit_amount), 0) AS gross_profit_amount
      FROM product_city_base
      GROUP BY city
      ORDER BY total_sales_amount DESC, city ASC
      LIMIT $${heatmapTopCitiesParameter}
    ),
    product_totals AS (
      SELECT
        product_id,
        COALESCE(SUM(total_sales_amount), 0) AS product_sales_amount
      FROM product_city_base
      GROUP BY product_id
    ),
    city_totals AS (
      SELECT
        city,
        COALESCE(SUM(total_sales_amount), 0) AS city_sales_amount
      FROM product_city_base
      GROUP BY city
    ),
    heatmap_cells AS (
      SELECT
        tp.product_id,
        tp.product_name,
        tp.category,
        tc.city,
        COALESCE(pcb.total_invoices, 0) AS total_invoices,
        COALESCE(pcb.total_quantity_sold, 0) AS total_quantity_sold,
        COALESCE(pcb.total_sales_amount, 0) AS total_sales_amount,
        COALESCE(pcb.gross_profit_amount, 0) AS gross_profit_amount,
        CASE
          WHEN COALESCE(pcb.total_sales_amount, 0) > 0
            THEN ROUND(
              (COALESCE(pcb.gross_profit_amount, 0) / COALESCE(pcb.total_sales_amount, 0)) * 100,
              2
            )
          ELSE 0
        END AS gross_margin_percent,
        CASE
          WHEN COALESCE(pt.product_sales_amount, 0) > 0
            THEN ROUND(
              (COALESCE(pcb.total_sales_amount, 0) / COALESCE(pt.product_sales_amount, 0)) * 100,
              2
            )
          ELSE 0
        END AS sales_share_in_product_percent,
        CASE
          WHEN COALESCE(ct.city_sales_amount, 0) > 0
            THEN ROUND(
              (COALESCE(pcb.total_sales_amount, 0) / COALESCE(ct.city_sales_amount, 0)) * 100,
              2
            )
          ELSE 0
        END AS sales_share_in_city_percent
      FROM top_products tp
      CROSS JOIN top_cities tc
      LEFT JOIN product_city_base pcb
        ON pcb.product_id = tp.product_id
       AND pcb.city = tc.city
      LEFT JOIN product_totals pt ON pt.product_id = tp.product_id
      LEFT JOIN city_totals ct ON ct.city = tc.city
    )
    SELECT
      product_id,
      product_name,
      category,
      city,
      total_invoices,
      total_quantity_sold,
      total_sales_amount,
      gross_profit_amount,
      gross_margin_percent,
      sales_share_in_product_percent,
      sales_share_in_city_percent
    FROM heatmap_cells
    ORDER BY product_name ASC, city ASC;
  `;

  const productCityBestPairsQuery = `
    WITH
      ${customersEnrichedCte},
    product_city_base AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(NULLIF(TRIM(ce.city), ''), 'Non renseignee') AS city,
        COUNT(DISTINCT i.id)::int AS total_invoices,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      INNER JOIN customers_enriched ce ON ce.id = i.customer_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
        ${heatmapFilterBindings.clause}
      GROUP BY
        p.id,
        p.name,
        p.category,
        COALESCE(NULLIF(TRIM(ce.city), ''), 'Non renseignee')
    )
    SELECT
      product_id,
      product_name,
      category,
      city,
      total_invoices,
      total_quantity_sold,
      total_sales_amount,
      gross_profit_amount,
      CASE
        WHEN COALESCE(total_sales_amount, 0) > 0
          THEN ROUND((COALESCE(gross_profit_amount, 0) / COALESCE(total_sales_amount, 0)) * 100, 2)
        ELSE 0
      END AS gross_margin_percent
    FROM product_city_base
    ORDER BY total_sales_amount DESC, total_quantity_sold DESC, product_name ASC, city ASC
    LIMIT $${heatmapBestPairsLimitParameter};
  `;

  const topPayingCustomersQuery = `
    WITH
      ${invoiceCogsCte},
      ${customersEnrichedCte}
    SELECT
      ce.id AS customer_id,
      ce.business_name,
      ce.city,
      ce.customer_type,
      ce.chain_name_resolved AS chain_name,
      ce.sales_channel_resolved AS sales_channel,
      COUNT(i.id)::int AS total_invoices,
      MAX(i.invoice_date) AS last_invoice_date,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(i.total_amount), 0) > 0
          THEN ROUND((COALESCE(SUM(i.paid_amount), 0) / COALESCE(SUM(i.total_amount), 0)) * 100, 2)
        ELSE 0
      END AS collection_rate_percent,
      CASE
        WHEN COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) > 0
          THEN ROUND(
            (
              COALESCE(
                SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
                0
              ) / COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
            ) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM customers_enriched ce
    INNER JOIN invoices i ON i.customer_id = ce.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY
      ce.id,
      ce.business_name,
      ce.city,
      ce.customer_type,
      ce.chain_name_resolved,
      ce.sales_channel_resolved
    ORDER BY total_collected_amount DESC, total_sales_amount DESC, business_name ASC
    LIMIT $2;
  `;

  const mostProfitableProductsQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
      COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
      COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(SUM(ii.line_total), 0) > 0
          THEN ROUND(
            (COALESCE(SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))), 0)
              / COALESCE(SUM(ii.line_total), 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    INNER JOIN products p ON p.id = ii.product_id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY p.id, p.name, p.sku, p.category
    ORDER BY gross_profit_amount DESC, total_sales_amount DESC, product_name ASC
    LIMIT $2;
  `;

  const customerMonthlyTrendQuery = `
    WITH period_series AS (
      SELECT
        month_start,
        half_index,
        CASE
          WHEN half_index = 1 THEN month_start
          ELSE month_start + INTERVAL '15 days'
        END::date AS period_start,
        CASE
          WHEN half_index = 1 THEN month_start + INTERVAL '14 days'
          ELSE (month_start + INTERVAL '1 month' - INTERVAL '1 day')
        END::date AS period_end
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_series(month_start)
      CROSS JOIN generate_series(1, 2) AS halves(half_index)
    ),
    top_customers AS (
      SELECT
        i.customer_id,
        c.business_name
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY i.customer_id, c.business_name
      ORDER BY COALESCE(SUM(i.total_amount), 0) DESC, c.business_name ASC
      LIMIT $1
    ),
    billed_periods AS (
      SELECT
        i.customer_id,
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END AS period_start,
        COALESCE(SUM(i.total_amount), 0) AS billed_amount
      FROM invoices i
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY
        i.customer_id,
        CASE
          WHEN EXTRACT(DAY FROM i.invoice_date) <= 15
            THEN DATE_TRUNC('month', i.invoice_date)::date
          ELSE (DATE_TRUNC('month', i.invoice_date) + INTERVAL '15 days')::date
        END
    ),
    paid_periods AS (
      SELECT
        i.customer_id,
        CASE
          WHEN EXTRACT(DAY FROM p.payment_date) <= 15
            THEN DATE_TRUNC('month', p.payment_date)::date
          ELSE (DATE_TRUNC('month', p.payment_date) + INTERVAL '15 days')::date
        END AS period_start,
        COALESCE(SUM(p.amount), 0) AS payments_received
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.payment_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY
        i.customer_id,
        CASE
          WHEN EXTRACT(DAY FROM p.payment_date) <= 15
            THEN DATE_TRUNC('month', p.payment_date)::date
          ELSE (DATE_TRUNC('month', p.payment_date) + INTERVAL '15 days')::date
        END
    )
    SELECT
      TO_CHAR(ps.month_start, 'YYYY-MM') || '-H' || ps.half_index AS period,
      TO_CHAR(ps.month_start, 'YYYY-MM') AS month_period,
      ps.half_index AS period_half,
      TO_CHAR(ps.period_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR(ps.period_end, 'YYYY-MM-DD') AS period_end,
      tc.customer_id,
      tc.business_name,
      COALESCE(bm.billed_amount, 0) AS billed_amount,
      COALESCE(pm.payments_received, 0) AS payments_received
    FROM top_customers tc
    CROSS JOIN period_series ps
    LEFT JOIN billed_periods bm
      ON bm.customer_id = tc.customer_id
     AND bm.period_start = ps.period_start
    LEFT JOIN paid_periods pm
      ON pm.customer_id = tc.customer_id
     AND pm.period_start = ps.period_start
    ORDER BY tc.business_name ASC, ps.period_start ASC;
  `;

  const decliningProductsQuery = `
    WITH product_windows AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.sku,
        COALESCE(SUM(
          CASE
            WHEN i.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
              THEN ii.quantity
            ELSE 0
          END
        ), 0) AS current_quantity,
        COALESCE(SUM(
          CASE
            WHEN i.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
              THEN ii.line_total
            ELSE 0
          END
        ), 0) AS current_sales_amount,
        COALESCE(SUM(
          CASE
            WHEN i.invoice_date >= CURRENT_DATE - INTERVAL '60 days'
             AND i.invoice_date < CURRENT_DATE - INTERVAL '30 days'
              THEN ii.quantity
            ELSE 0
          END
        ), 0) AS previous_quantity,
        COALESCE(SUM(
          CASE
            WHEN i.invoice_date >= CURRENT_DATE - INTERVAL '60 days'
             AND i.invoice_date < CURRENT_DATE - INTERVAL '30 days'
              THEN ii.line_total
            ELSE 0
          END
        ), 0) AS previous_sales_amount
      FROM products p
      LEFT JOIN invoice_items ii ON ii.product_id = p.id
      LEFT JOIN invoices i
        ON i.id = ii.invoice_id
       AND i.status IN ('issued', 'partial', 'paid')
       AND i.invoice_date >= CURRENT_DATE - INTERVAL '60 days'
      GROUP BY p.id, p.name, p.sku
    )
    SELECT
      product_id,
      product_name,
      sku,
      previous_quantity,
      current_quantity,
      previous_sales_amount,
      current_sales_amount,
      ROUND(current_quantity - previous_quantity, 2) AS quantity_delta,
      CASE
        WHEN previous_quantity > 0
          THEN ROUND(((current_quantity - previous_quantity) / previous_quantity) * 100, 2)
        ELSE NULL
      END AS quantity_change_percent,
      ROUND(current_sales_amount - previous_sales_amount, 2) AS sales_delta,
      CASE
        WHEN previous_sales_amount > 0
          THEN ROUND(((current_sales_amount - previous_sales_amount) / previous_sales_amount) * 100, 2)
        ELSE NULL
      END AS sales_change_percent
    FROM product_windows
    WHERE previous_quantity > 0
      AND current_quantity < previous_quantity
    ORDER BY (previous_sales_amount - current_sales_amount) DESC, previous_quantity DESC, product_name ASC
    LIMIT $1;
  `;

  const dormantClientsQuery = `
    WITH
      ${customersEnrichedCte},
    customer_stats AS (
      SELECT
        ce.id AS customer_id,
        ce.business_name,
        ce.city,
        ce.chain_name_resolved AS chain_name,
        ce.sales_channel_resolved AS sales_channel,
        MAX(i.invoice_date) AS last_invoice_date,
        COUNT(i.id)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM customers_enriched ce
      INNER JOIN invoices i ON i.customer_id = ce.id
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY
        ce.id,
        ce.business_name,
        ce.city,
        ce.chain_name_resolved,
        ce.sales_channel_resolved
    )
    SELECT
      customer_id,
      business_name,
      city,
      chain_name,
      sales_channel,
      last_invoice_date,
      total_invoices,
      total_sales_amount,
      total_collected_amount,
      total_receivables,
      (CURRENT_DATE - last_invoice_date)::int AS days_since_last_invoice
    FROM customer_stats
    WHERE (CURRENT_DATE - last_invoice_date) >= $1
    ORDER BY days_since_last_invoice DESC, total_sales_amount DESC, business_name ASC
    LIMIT $2;
  `;

  const reactivationCandidatesQuery = `
    WITH
      ${customersEnrichedCte},
    customer_stats AS (
      SELECT
        ce.id AS customer_id,
        ce.business_name,
        ce.city,
        ce.chain_name_resolved AS chain_name,
        ce.sales_channel_resolved AS sales_channel,
        MAX(i.invoice_date) AS last_invoice_date,
        COUNT(i.id)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM customers_enriched ce
      INNER JOIN invoices i ON i.customer_id = ce.id
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY
        ce.id,
        ce.business_name,
        ce.city,
        ce.chain_name_resolved,
        ce.sales_channel_resolved
    )
    SELECT
      customer_id,
      business_name,
      city,
      chain_name,
      sales_channel,
      last_invoice_date,
      total_invoices,
      total_sales_amount,
      total_collected_amount,
      total_receivables,
      (CURRENT_DATE - last_invoice_date)::int AS days_since_last_invoice
    FROM customer_stats
    WHERE (CURRENT_DATE - last_invoice_date) >= 30
      AND COALESCE(total_receivables, 0) <= 0
    ORDER BY total_sales_amount DESC, days_since_last_invoice DESC, business_name ASC
    LIMIT $1;
  `;

  const [
    summaryResult,
    monthlyTrendResult,
    salesByCityResult,
    salesByWarehouseResult,
    salesByChainResult,
    salesByChannelResult,
    salesByCustomerResult,
    salesByProductResult,
    productCityHeatmapResult,
    productCityBestPairsResult,
    topPayingCustomersResult,
    mostProfitableProductsResult,
    customerMonthlyTrendResult,
    decliningProductsResult,
    dormantClientsResult,
    reactivationCandidatesResult
  ] = await Promise.all([
    pool.query(summaryQuery, [resolvedPeriodDays]),
    pool.query(monthlyTrendQuery),
    pool.query(salesByCityQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(salesByWarehouseQuery, [resolvedPeriodDays]),
    pool.query(salesByChainQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(salesByChannelQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(salesByCustomerQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(salesByProductQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(productCityHeatmapQuery, [
      normalizedHeatmapFilters.days,
      ...heatmapFilterBindings.values,
      normalizedHeatmapFilters.topProducts,
      normalizedHeatmapFilters.topCities
    ]),
    pool.query(productCityBestPairsQuery, [
      normalizedHeatmapFilters.days,
      ...heatmapFilterBindings.values,
      heatmapBestPairLimit
    ]),
    pool.query(topPayingCustomersQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(mostProfitableProductsQuery, [resolvedPeriodDays, resolvedTopLimit]),
    pool.query(customerMonthlyTrendQuery, [Math.min(resolvedTopLimit, 5)]),
    pool.query(decliningProductsQuery, [resolvedTopLimit]),
    pool.query(dormantClientsQuery, [45, resolvedTopLimit]),
    pool.query(reactivationCandidatesQuery, [resolvedTopLimit])
  ]);

  const summary = summaryResult.rows[0] || {};
  const totalCommercialSales = roundAmount(summary.total_sales_amount);
  const salesByCity = salesByCityResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const salesByWarehouse = salesByWarehouseResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const salesByChain = salesByChainResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const salesByChannel = salesByChannelResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const salesByCustomer = salesByCustomerResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const topPayingCustomers = topPayingCustomersResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalCommercialSales)
  );
  const dormantClients = dormantClientsResult.rows.map((row) => ({
    ...normalizeCommercialAggregateRow(row, totalCommercialSales),
    days_since_last_invoice: Number(row.days_since_last_invoice || 0)
  }));
  const reactivationCandidates = reactivationCandidatesResult.rows.map((row) => ({
    ...normalizeCommercialAggregateRow(row, totalCommercialSales),
    days_since_last_invoice: Number(row.days_since_last_invoice || 0)
  }));
  const salesByProduct = salesByProductResult.rows.map((row) => ({
    ...row,
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0),
    sales_share_percent: computeMarginPercent(
      totalCommercialSales,
      row.total_sales_amount
    )
  }));
  const productCityHeatmapCells = productCityHeatmapResult.rows.map((row) =>
    normalizeHeatmapCellRow(row)
  );
  const productCityHeatmapProducts = [
    ...new Map(
      productCityHeatmapCells.map((row) => [
        row.product_id,
        {
          product_id: row.product_id,
          product_name: row.product_name,
          category: row.category,
          total_sales_amount: roundAmount(
            productCityHeatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            productCityHeatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);
  const productCityHeatmapCities = [
    ...new Map(
      productCityHeatmapCells.map((row) => [
        row.city,
        {
          city: row.city,
          total_sales_amount: roundAmount(
            productCityHeatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            productCityHeatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);
  const heatmapMaxSalesAmount = productCityHeatmapCells.reduce(
    (maxValue, row) => Math.max(maxValue, Number(row.total_sales_amount || 0)),
    0
  );
  const productCityBestPairs = productCityBestPairsResult.rows.map((row) => ({
    ...row,
    total_invoices: Number(row.total_invoices || 0),
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: roundAmount(row.total_sales_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0)
  }));
  const mostProfitableProducts = mostProfitableProductsResult.rows.map((row) => ({
    ...row,
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    gross_margin_percent: Number(row.gross_margin_percent || 0),
    sales_share_percent: computeMarginPercent(
      totalCommercialSales,
      row.total_sales_amount
    )
  }));

  return {
    filters: {
      period_days: Number(resolvedPeriodDays || 0),
      top_limit: Number(resolvedTopLimit || 0),
      dormant_days: 45,
      reactivation_days: 30
    },
    summary: {
      total_invoices: Number(summary.total_invoices || 0),
      active_customers: Number(summary.active_customers || 0),
      active_warehouses: Number(summary.active_warehouses || 0),
      active_cities: Number(summary.active_cities || 0),
      active_chains: Number(summary.active_chains || 0),
      active_channels: Number(summary.active_channels || 0),
      total_sales_amount: roundAmount(summary.total_sales_amount),
      total_net_sales_amount: roundAmount(summary.total_net_sales_amount),
      total_collected_amount: roundAmount(summary.total_collected_amount),
      total_receivables: roundAmount(summary.total_receivables),
      total_cogs_amount: roundAmount(summary.total_cogs_amount),
      gross_profit_amount: roundAmount(summary.gross_profit_amount),
      gross_margin_percent: Number(summary.gross_margin_percent || 0)
    },
    monthly_trend: monthlyTrendResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_net_sales_amount: roundAmount(row.total_net_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount)
    })),
    performance_highlights: {
      top_city: salesByCity[0] || null,
      top_chain: salesByChain[0] || null,
      top_channel: salesByChannel[0] || null,
      top_customer: salesByCustomer[0] || null,
      top_product_by_sales: salesByProduct[0] || null,
      top_product_by_profit: mostProfitableProducts[0] || null,
      top_warehouse: salesByWarehouse[0] || null
    },
    product_city_heatmap: {
      filters: {
        period_days: Number(normalizedHeatmapFilters.days || 0),
        warehouse_id: normalizedHeatmapFilters.warehouseId,
        chain_name: normalizedHeatmapFilters.chainName,
        sales_channel: normalizedHeatmapFilters.salesChannel,
        top_products: Number(normalizedHeatmapFilters.topProducts || 0),
        top_cities: Number(normalizedHeatmapFilters.topCities || 0)
      },
      products: productCityHeatmapProducts,
      cities: productCityHeatmapCities,
      cells: productCityHeatmapCells,
      max_sales_amount: roundAmount(heatmapMaxSalesAmount),
      best_pairs: productCityBestPairs
    },
    sales_by_city: salesByCity,
    sales_by_warehouse: salesByWarehouse,
    sales_by_chain: salesByChain,
    sales_by_channel: salesByChannel,
    sales_by_customer: salesByCustomer,
    sales_by_product: salesByProduct,
    top_paying_customers: topPayingCustomers,
    most_profitable_products: mostProfitableProducts,
    customer_monthly_trend: customerMonthlyTrendResult.rows.map((row) => ({
      ...row,
      billed_amount: roundAmount(row.billed_amount),
      payments_received: roundAmount(row.payments_received)
    })),
    declining_products: decliningProductsResult.rows.map((row) => ({
      ...row,
      previous_quantity: roundAmount(row.previous_quantity),
      current_quantity: roundAmount(row.current_quantity),
      previous_sales_amount: roundAmount(row.previous_sales_amount),
      current_sales_amount: roundAmount(row.current_sales_amount),
      quantity_delta: roundAmount(row.quantity_delta),
      quantity_change_percent:
        row.quantity_change_percent === null
          ? null
          : Number(row.quantity_change_percent),
      sales_delta: roundAmount(row.sales_delta),
      sales_change_percent:
        row.sales_change_percent === null
          ? null
          : Number(row.sales_change_percent)
    })),
    dormant_clients: dormantClients,
    reactivation_candidates: reactivationCandidates
  };
}

export async function getCollectionsDashboard(filters = {}) {
  await ensureDashboardSchema(pool);

  const now = new Date();
  const endDate = filters.endDate || formatIsoDate(now);
  const startDate =
    filters.startDate ||
    formatIsoDate(addDays(new Date(`${endDate}T00:00:00`), -89));
  const warehouseId = normalizeOptionalPositiveWholeNumber(
    filters.warehouseId,
    1000000
  );
  const customerId = normalizeOptionalPositiveWholeNumber(
    filters.customerId,
    1000000
  );
  const customerCity = normalizeOptionalTextFilter(filters.customerCity);
  const entryType = ["all", "invoices", "payments"].includes(filters.entryType)
    ? filters.entryType
    : "all";
  const topProducts = normalizePositiveWholeNumber(filters.topProducts, 8, 20);
  const topCities = normalizePositiveWholeNumber(filters.topCities, 8, 20);
  const invoiceLimit = normalizePositiveWholeNumber(filters.invoiceLimit, 80, 200);
  const paymentLimit = normalizePositiveWholeNumber(filters.paymentLimit, 80, 200);

  const scopedFilters = {
    startDate,
    endDate,
    warehouseId,
    customerId,
    customerCity
  };
  const invoiceBindings = buildCollectionInvoiceFilterBindings(scopedFilters, {
    invoice: "i",
    customer: "c"
  });
  const paymentBindings = buildCollectionPaymentFilterBindings(scopedFilters, {
    payment: "p",
    invoice: "i",
    customer: "c"
  });

  const invoicesSummaryQuery = `
    SELECT
      COUNT(*)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(c.city), ''), 'non renseignee')))::int AS total_cities,
      COALESCE(SUM(i.total_amount), 0) AS total_invoiced_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_paid_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_balance_due
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    ${invoiceBindings.whereClause};
  `;

  const invoicesRowsQuery = `
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
      COALESCE(w.city, '') AS warehouse_city,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.paid_amount, 0) AS paid_amount,
      COALESCE(i.balance_due, 0) AS balance_due
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    ${invoiceBindings.whereClause}
    ORDER BY i.invoice_date DESC, i.id DESC
    LIMIT $${invoiceBindings.nextParameterIndex};
  `;

  const unpaidSummaryQuery = `
    SELECT
      COUNT(*)::int AS total_unpaid_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(c.city), ''), 'non renseignee')))::int AS total_cities,
      COALESCE(SUM(i.balance_due), 0) AS total_unpaid_amount,
      COUNT(*) FILTER (
        WHERE i.due_date IS NOT NULL
          AND i.due_date < CURRENT_DATE
      )::int AS overdue_invoices_count,
      COALESCE(SUM(
        CASE
          WHEN i.due_date IS NOT NULL
           AND i.due_date < CURRENT_DATE
            THEN i.balance_due
          ELSE 0
        END
      ), 0) AS overdue_balance_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    ${invoiceBindings.whereClause}
      AND i.status IN ('issued', 'partial')
      AND COALESCE(i.balance_due, 0) > 0;
  `;

  const unpaidRowsQuery = `
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
      COALESCE(w.city, '') AS warehouse_city,
      COALESCE(i.total_amount, 0) AS total_amount,
      COALESCE(i.paid_amount, 0) AS paid_amount,
      COALESCE(i.balance_due, 0) AS balance_due,
      CASE
        WHEN i.due_date IS NULL THEN NULL
        ELSE GREATEST((CURRENT_DATE - i.due_date), 0)
      END AS days_overdue
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    ${invoiceBindings.whereClause}
      AND i.status IN ('issued', 'partial')
      AND COALESCE(i.balance_due, 0) > 0
    ORDER BY
      CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END ASC,
      i.due_date ASC,
      i.invoice_date DESC,
      i.id DESC
    LIMIT $${invoiceBindings.nextParameterIndex};
  `;

  const paymentsSummaryQuery = `
    SELECT
      COUNT(*)::int AS total_payments,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COUNT(DISTINCT LOWER(COALESCE(NULLIF(TRIM(c.city), ''), 'non renseignee')))::int AS total_cities,
      COALESCE(SUM(p.amount), 0) AS total_payments_amount
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    ${paymentBindings.whereClause};
  `;

  const paymentsRowsQuery = `
    SELECT
      p.id AS payment_id,
      p.payment_date,
      p.amount,
      p.payment_method,
      p.reference,
      p.notes,
      p.accounting_status,
      p.accounting_entry_id,
      p.accounting_message,
      i.id AS invoice_id,
      i.invoice_number,
      i.customer_id,
      c.business_name AS customer_name,
      COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS customer_city,
      i.warehouse_id,
      COALESCE(w.name, 'Depot non renseigne') AS warehouse_name,
      COALESCE(w.city, '') AS warehouse_city
    FROM payments p
    INNER JOIN invoices i ON i.id = p.invoice_id
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN warehouses w ON w.id = i.warehouse_id
    ${paymentBindings.whereClause}
    ORDER BY p.payment_date DESC, p.id DESC
    LIMIT $${paymentBindings.nextParameterIndex};
  `;

  const heatmapFilterBindings = buildCollectionInvoiceFilterBindings(
    scopedFilters,
    { invoice: "i", customer: "c" },
    1
  );
  const heatmapTopProductsParameter = heatmapFilterBindings.nextParameterIndex;
  const heatmapTopCitiesParameter = heatmapTopProductsParameter + 1;

  const productCityHeatmapQuery = `
    WITH product_city_base AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
        COUNT(DISTINCT i.id)::int AS total_invoices,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN customers c ON c.id = i.customer_id
      INNER JOIN products p ON p.id = ii.product_id
      ${heatmapFilterBindings.whereClause}
      GROUP BY
        p.id,
        p.name,
        p.category,
        COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee')
    ),
    top_products AS (
      SELECT
        product_id,
        product_name,
        category
      FROM product_city_base
      GROUP BY product_id, product_name, category
      ORDER BY COALESCE(SUM(total_sales_amount), 0) DESC, product_name ASC
      LIMIT $${heatmapTopProductsParameter}
    ),
    top_cities AS (
      SELECT city
      FROM product_city_base
      GROUP BY city
      ORDER BY COALESCE(SUM(total_sales_amount), 0) DESC, city ASC
      LIMIT $${heatmapTopCitiesParameter}
    ),
    product_totals AS (
      SELECT
        product_id,
        COALESCE(SUM(total_sales_amount), 0) AS product_sales_amount
      FROM product_city_base
      GROUP BY product_id
    ),
    city_totals AS (
      SELECT
        city,
        COALESCE(SUM(total_sales_amount), 0) AS city_sales_amount
      FROM product_city_base
      GROUP BY city
    )
    SELECT
      tp.product_id,
      tp.product_name,
      tp.category,
      tc.city,
      COALESCE(pcb.total_invoices, 0) AS total_invoices,
      COALESCE(pcb.total_quantity_sold, 0) AS total_quantity_sold,
      COALESCE(pcb.total_sales_amount, 0) AS total_sales_amount,
      COALESCE(pcb.gross_profit_amount, 0) AS gross_profit_amount,
      CASE
        WHEN COALESCE(pcb.total_sales_amount, 0) > 0
          THEN ROUND(
            (COALESCE(pcb.gross_profit_amount, 0) / COALESCE(pcb.total_sales_amount, 0)) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent,
      CASE
        WHEN COALESCE(pt.product_sales_amount, 0) > 0
          THEN ROUND(
            (COALESCE(pcb.total_sales_amount, 0) / COALESCE(pt.product_sales_amount, 0)) * 100,
            2
          )
        ELSE 0
      END AS sales_share_in_product_percent,
      CASE
        WHEN COALESCE(ct.city_sales_amount, 0) > 0
          THEN ROUND(
            (COALESCE(pcb.total_sales_amount, 0) / COALESCE(ct.city_sales_amount, 0)) * 100,
            2
          )
        ELSE 0
      END AS sales_share_in_city_percent
    FROM top_products tp
    CROSS JOIN top_cities tc
    LEFT JOIN product_city_base pcb
      ON pcb.product_id = tp.product_id
     AND pcb.city = tc.city
    LEFT JOIN product_totals pt ON pt.product_id = tp.product_id
    LEFT JOIN city_totals ct ON ct.city = tc.city
    ORDER BY tp.product_name ASC, tc.city ASC;
  `;

  const [
    invoicesSummaryResult,
    invoicesRowsResult,
    unpaidSummaryResult,
    unpaidRowsResult,
    paymentsSummaryResult,
    paymentsRowsResult,
    heatmapResult
  ] = await Promise.all([
    pool.query(invoicesSummaryQuery, invoiceBindings.values),
    pool.query(invoicesRowsQuery, [...invoiceBindings.values, invoiceLimit]),
    pool.query(unpaidSummaryQuery, invoiceBindings.values),
    pool.query(unpaidRowsQuery, [...invoiceBindings.values, invoiceLimit]),
    pool.query(paymentsSummaryQuery, paymentBindings.values),
    pool.query(paymentsRowsQuery, [...paymentBindings.values, paymentLimit]),
    pool.query(productCityHeatmapQuery, [
      ...heatmapFilterBindings.values,
      topProducts,
      topCities
    ])
  ]);

  const invoicesSummary = invoicesSummaryResult.rows[0] || {};
  const unpaidSummary = unpaidSummaryResult.rows[0] || {};
  const paymentsSummary = paymentsSummaryResult.rows[0] || {};
  const totalInvoicedAmount = roundAmount(invoicesSummary.total_invoiced_amount);
  const totalPaymentsAmount = roundAmount(paymentsSummary.total_payments_amount);
  const heatmapCells = heatmapResult.rows.map((row) => normalizeHeatmapCellRow(row));
  const heatmapProducts = [
    ...new Map(
      heatmapCells.map((row) => [
        row.product_id,
        {
          product_id: row.product_id,
          product_name: row.product_name,
          category: row.category,
          total_sales_amount: roundAmount(
            heatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            heatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);
  const heatmapCities = [
    ...new Map(
      heatmapCells.map((row) => [
        row.city,
        {
          city: row.city,
          total_sales_amount: roundAmount(
            heatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            heatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      customer_city: customerCity,
      entry_type: entryType,
      top_products: topProducts,
      top_cities: topCities,
      invoice_limit: invoiceLimit,
      payment_limit: paymentLimit
    },
    summary: {
      total_invoices: Number(invoicesSummary.total_invoices || 0),
      total_invoice_customers: Number(invoicesSummary.total_customers || 0),
      total_invoice_cities: Number(invoicesSummary.total_cities || 0),
      total_invoiced_amount: totalInvoicedAmount,
      total_invoice_paid_amount: roundAmount(invoicesSummary.total_paid_amount),
      total_invoice_balance_due: roundAmount(invoicesSummary.total_balance_due),
      total_unpaid_invoices: Number(unpaidSummary.total_unpaid_invoices || 0),
      total_unpaid_customers: Number(unpaidSummary.total_customers || 0),
      total_unpaid_cities: Number(unpaidSummary.total_cities || 0),
      total_unpaid_amount: roundAmount(unpaidSummary.total_unpaid_amount),
      overdue_invoices_count: Number(unpaidSummary.overdue_invoices_count || 0),
      overdue_balance_amount: roundAmount(unpaidSummary.overdue_balance_amount),
      total_payments: Number(paymentsSummary.total_payments || 0),
      total_payment_customers: Number(paymentsSummary.total_customers || 0),
      total_payment_cities: Number(paymentsSummary.total_cities || 0),
      total_payments_amount: totalPaymentsAmount,
      invoiced_payment_gap: roundAmount(totalInvoicedAmount - totalPaymentsAmount),
      collection_rate_percent:
        totalInvoicedAmount > 0
          ? roundAmount((totalPaymentsAmount / totalInvoicedAmount) * 100)
          : 0
    },
    issued_invoices: invoicesRowsResult.rows.map((row) => ({
      ...row,
      total_amount: roundAmount(row.total_amount),
      paid_amount: roundAmount(row.paid_amount),
      balance_due: roundAmount(row.balance_due)
    })),
    unpaid_invoices: unpaidRowsResult.rows.map((row) => ({
      ...row,
      total_amount: roundAmount(row.total_amount),
      paid_amount: roundAmount(row.paid_amount),
      balance_due: roundAmount(row.balance_due),
      days_overdue:
        row.days_overdue === null ? null : Number(row.days_overdue || 0)
    })),
    payments: paymentsRowsResult.rows.map((row) => ({
      ...row,
      amount: roundAmount(row.amount)
    })),
    product_city_heatmap: {
      filters: {
        start_date: startDate,
        end_date: endDate,
        warehouse_id: warehouseId,
        customer_id: customerId,
        customer_city: customerCity,
        top_products: topProducts,
        top_cities: topCities
      },
      products: heatmapProducts,
      cities: heatmapCities,
      cells: heatmapCells
    }
  };
}

export async function getExecutiveAnalyticsDashboard(filters = {}) {
  await ensureDashboardSchema(pool);

  const topLimit = normalizePositiveWholeNumber(filters.topLimit, 10, 20);
  const warehouseId = normalizeOptionalPositiveWholeNumber(
    filters.warehouseId,
    1000000
  );
  const endDate = filters.endDate || formatIsoDate(new Date());
  const startDate =
    filters.startDate ||
    formatIsoDate(addDays(new Date(`${endDate}T00:00:00`), -179));

  const baseValues = [startDate, endDate, warehouseId];

  const monthlyTrendQuery = `
    WITH month_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', $1::date),
        DATE_TRUNC('month', $2::date),
        INTERVAL '1 month'
      )::date AS month_start
    ),
    invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
    invoice_monthly AS (
      SELECT
        DATE_TRUNC('month', i.invoice_date)::date AS month_start,
        COALESCE(SUM(i.total_amount), 0) AS invoiced_amount,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS net_sales_amount,
        COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS cogs_amount,
        COALESCE(
          SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
          0
        ) AS gross_profit_amount
      FROM invoices i
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY DATE_TRUNC('month', i.invoice_date)::date
    ),
    payment_monthly AS (
      SELECT
        DATE_TRUNC('month', p.payment_date)::date AS month_start,
        COALESCE(SUM(p.amount), 0) AS payments_received
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.payment_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY DATE_TRUNC('month', p.payment_date)::date
    ),
    expense_monthly AS (
      SELECT
        DATE_TRUNC('month', e.expense_date)::date AS month_start,
        COALESCE(SUM(e.amount), 0) AS expenses_amount
      FROM expenses e
      WHERE e.expense_date BETWEEN $1::date AND $2::date
      GROUP BY DATE_TRUNC('month', e.expense_date)::date
    )
    SELECT
      TO_CHAR(ms.month_start, 'YYYY-MM') AS period,
      TO_CHAR(ms.month_start, 'Mon YYYY') AS period_label,
      TO_CHAR(ms.month_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR((ms.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date, 'YYYY-MM-DD') AS period_end,
      COALESCE(im.invoiced_amount, 0) AS invoiced_amount,
      COALESCE(pm.payments_received, 0) AS payments_received,
      COALESCE(em.expenses_amount, 0) AS expenses_amount,
      COALESCE(im.net_sales_amount, 0) AS net_sales_amount,
      COALESCE(im.cogs_amount, 0) AS cogs_amount,
      COALESCE(im.gross_profit_amount, 0) AS gross_profit_amount
    FROM month_series ms
    LEFT JOIN invoice_monthly im ON im.month_start = ms.month_start
    LEFT JOIN payment_monthly pm ON pm.month_start = ms.month_start
    LEFT JOIN expense_monthly em ON em.month_start = ms.month_start
    ORDER BY ms.month_start ASC;
  `;

  const salesByCityQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
      COUNT(DISTINCT i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date BETWEEN $1::date AND $2::date
      AND ($3::int IS NULL OR i.warehouse_id = $3)
    GROUP BY COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee')
    ORDER BY total_sales_amount DESC, city ASC
    LIMIT $4;
  `;

  const salesByPointOfSaleQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      c.id AS customer_id,
      c.business_name,
      COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
      COUNT(DISTINCT i.id)::int AS total_invoices,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date BETWEEN $1::date AND $2::date
      AND ($3::int IS NULL OR i.warehouse_id = $3)
    GROUP BY c.id, c.business_name, COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee')
    ORDER BY total_sales_amount DESC, business_name ASC
    LIMIT $4;
  `;

  const salesByWarehouseQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COUNT(DISTINCT i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM warehouses w
    LEFT JOIN invoices i
      ON i.warehouse_id = w.id
      AND i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date BETWEEN $1::date AND $2::date
      AND ($3::int IS NULL OR i.warehouse_id = $3)
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    GROUP BY w.id, w.name, w.city
    HAVING COALESCE(SUM(i.total_amount), 0) > 0 OR $3::int IS NULL
    ORDER BY total_sales_amount DESC, warehouse_name ASC;
  `;

  const paretoProductsQuery = `
    WITH product_sales AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY p.id, p.name, p.category
    )
    SELECT
      ps.*,
      CASE
        WHEN COALESCE(SUM(ps.total_sales_amount) OVER (), 0) > 0
          THEN ROUND(
            (
              SUM(ps.total_sales_amount) OVER (
                ORDER BY ps.total_sales_amount DESC, ps.product_name ASC
              ) / SUM(ps.total_sales_amount) OVER ()
            ) * 100,
            2
          )
        ELSE 0
      END AS cumulative_sales_share_percent,
      ROW_NUMBER() OVER (
        ORDER BY ps.total_sales_amount DESC, ps.product_name ASC
      )::int AS rank_order
    FROM product_sales ps
    ORDER BY ps.total_sales_amount DESC, ps.product_name ASC
    LIMIT $4;
  `;

  const marginByProductQuery = `
    WITH product_sales AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY p.id, p.name, p.category
    ),
    expense_total AS (
      SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
      FROM expenses e
      WHERE e.expense_date BETWEEN $1::date AND $2::date
    ),
    sales_total AS (
      SELECT COALESCE(SUM(total_sales_amount), 0) AS total_sales_amount
      FROM product_sales
    )
    SELECT
      ps.*,
      CASE
        WHEN st.total_sales_amount > 0
          THEN ROUND((ps.total_sales_amount / st.total_sales_amount) * et.total_expenses, 2)
        ELSE 0
      END AS allocated_expenses_amount,
      ROUND(
        ps.gross_profit_amount - (
          CASE
            WHEN st.total_sales_amount > 0
              THEN (ps.total_sales_amount / st.total_sales_amount) * et.total_expenses
            ELSE 0
          END
        ),
        2
      ) AS net_profit_estimate,
      CASE
        WHEN ps.total_sales_amount > 0
          THEN ROUND(
            (
              (
                ps.gross_profit_amount - (
                  CASE
                    WHEN st.total_sales_amount > 0
                      THEN (ps.total_sales_amount / st.total_sales_amount) * et.total_expenses
                    ELSE 0
                  END
                )
              ) / ps.total_sales_amount
            ) * 100,
            2
          )
        ELSE 0
      END AS net_margin_estimate_percent
    FROM product_sales ps
    CROSS JOIN expense_total et
    CROSS JOIN sales_total st
    ORDER BY net_profit_estimate DESC, gross_profit_amount DESC, product_name ASC
    LIMIT $4;
  `;

  const heatmapQuery = `
    WITH product_city_base AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
        COUNT(DISTINCT i.id)::int AS total_invoices,
        COALESCE(SUM(ii.quantity), 0) AS total_quantity_sold,
        COALESCE(SUM(ii.line_total), 0) AS total_sales_amount,
        COALESCE(
          SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))),
          0
        ) AS gross_profit_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY p.id, p.name, p.category, COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee')
    ),
    top_products AS (
      SELECT product_id
      FROM product_city_base
      GROUP BY product_id
      ORDER BY COALESCE(SUM(total_sales_amount), 0) DESC, product_id ASC
      LIMIT $4
    ),
    top_cities AS (
      SELECT city
      FROM product_city_base
      GROUP BY city
      ORDER BY COALESCE(SUM(total_sales_amount), 0) DESC, city ASC
      LIMIT $5
    ),
    product_totals AS (
      SELECT
        product_id,
        COALESCE(SUM(total_sales_amount), 0) AS product_total_sales
      FROM product_city_base
      GROUP BY product_id
    ),
    city_totals AS (
      SELECT
        city,
        COALESCE(SUM(total_sales_amount), 0) AS city_total_sales
      FROM product_city_base
      GROUP BY city
    )
    SELECT
      pcb.product_id,
      pcb.product_name,
      pcb.category,
      pcb.city,
      pcb.total_invoices,
      pcb.total_quantity_sold,
      pcb.total_sales_amount,
      pcb.gross_profit_amount,
      CASE
        WHEN pcb.total_sales_amount > 0
          THEN ROUND((pcb.gross_profit_amount / pcb.total_sales_amount) * 100, 2)
        ELSE 0
      END AS gross_margin_percent,
      CASE
        WHEN COALESCE(pt.product_total_sales, 0) > 0
          THEN ROUND((pcb.total_sales_amount / pt.product_total_sales) * 100, 2)
        ELSE 0
      END AS sales_share_in_product_percent,
      CASE
        WHEN COALESCE(ct.city_total_sales, 0) > 0
          THEN ROUND((pcb.total_sales_amount / ct.city_total_sales) * 100, 2)
        ELSE 0
      END AS sales_share_in_city_percent
    FROM product_city_base pcb
    INNER JOIN top_products tp ON tp.product_id = pcb.product_id
    INNER JOIN top_cities tc2 ON tc2.city = pcb.city
    LEFT JOIN product_totals pt ON pt.product_id = pcb.product_id
    LEFT JOIN city_totals ct ON ct.city = pcb.city
    ORDER BY pcb.product_name ASC, pcb.city ASC;
  `;

  const stockCoverageQuery = `
    WITH stock_base AS (
      SELECT
        ws.product_id,
        COALESCE(SUM(ws.quantity), 0) AS current_stock_quantity
      FROM warehouse_stock ws
      WHERE ($3::int IS NULL OR ws.warehouse_id = $3)
      GROUP BY ws.product_id
    ),
    sales_base AS (
      SELECT
        ii.product_id,
        COALESCE(SUM(ii.quantity), 0) AS sold_quantity
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR i.warehouse_id = $3)
      GROUP BY ii.product_id
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.category,
      COALESCE(sb.current_stock_quantity, 0) AS current_stock_quantity,
      COALESCE(sl.sold_quantity, 0) AS sold_quantity,
      GREATEST(($2::date - $1::date + 1), 1)::int AS analysis_days,
      ROUND(
        COALESCE(sl.sold_quantity, 0) / GREATEST(($2::date - $1::date + 1), 1),
        2
      ) AS avg_daily_sales,
      CASE
        WHEN COALESCE(sl.sold_quantity, 0) > 0
          THEN ROUND(
            COALESCE(sb.current_stock_quantity, 0)
            / NULLIF(
                COALESCE(sl.sold_quantity, 0)
                / GREATEST(($2::date - $1::date + 1), 1),
                0
              ),
            2
          )
        ELSE NULL
      END AS coverage_days,
      COALESCE(p.alert_threshold, 0) AS alert_threshold
    FROM products p
    LEFT JOIN stock_base sb ON sb.product_id = p.id
    LEFT JOIN sales_base sl ON sl.product_id = p.id
    WHERE COALESCE(sb.current_stock_quantity, 0) > 0 OR COALESCE(sl.sold_quantity, 0) > 0
    ORDER BY coverage_days ASC NULLS LAST, sold_quantity DESC, product_name ASC
    LIMIT $4;
  `;

  const receivablesBucketsQuery = `
    WITH open_invoices AS (
      SELECT
        i.id,
        i.customer_id,
        c.business_name,
        COALESCE(i.balance_due, 0) AS balance_due,
        i.due_date,
        CASE
          WHEN i.due_date IS NULL THEN NULL
          ELSE GREATEST(($1::date - i.due_date), 0)
        END AS days_overdue
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('issued', 'partial')
        AND COALESCE(i.balance_due, 0) > 0
        AND i.invoice_date <= $1::date
        AND ($2::int IS NULL OR i.warehouse_id = $2)
    )
    SELECT
      COUNT(*)::int AS open_invoices_count,
      COALESCE(SUM(balance_due), 0) AS total_balance_due,
      COALESCE(SUM(CASE WHEN due_date IS NULL OR due_date > $1::date THEN balance_due ELSE 0 END), 0) AS current_balance,
      COALESCE(SUM(CASE WHEN days_overdue BETWEEN 1 AND 15 THEN balance_due ELSE 0 END), 0) AS bucket_1_15,
      COALESCE(SUM(CASE WHEN days_overdue BETWEEN 16 AND 30 THEN balance_due ELSE 0 END), 0) AS bucket_16_30,
      COALESCE(SUM(CASE WHEN days_overdue BETWEEN 31 AND 60 THEN balance_due ELSE 0 END), 0) AS bucket_31_60,
      COALESCE(SUM(CASE WHEN days_overdue > 60 THEN balance_due ELSE 0 END), 0) AS bucket_60_plus
    FROM open_invoices;
  `;

  const overdueCustomersQuery = `
    WITH open_invoices AS (
      SELECT
        i.customer_id,
        c.business_name,
        COALESCE(NULLIF(TRIM(c.city), ''), 'Non renseignee') AS city,
        COALESCE(i.balance_due, 0) AS balance_due,
        i.due_date,
        CASE
          WHEN i.due_date IS NULL THEN NULL
          ELSE GREATEST(($1::date - i.due_date), 0)
        END AS days_overdue
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      WHERE i.status IN ('issued', 'partial')
        AND COALESCE(i.balance_due, 0) > 0
        AND i.invoice_date <= $1::date
        AND ($2::int IS NULL OR i.warehouse_id = $2)
    )
    SELECT
      customer_id,
      business_name,
      city,
      COUNT(*)::int AS open_invoices_count,
      MAX(days_overdue)::int AS max_days_overdue,
      COALESCE(SUM(balance_due), 0) AS total_balance_due
    FROM open_invoices
    WHERE COALESCE(days_overdue, 0) > 0
    GROUP BY customer_id, business_name, city
    ORDER BY total_balance_due DESC, max_days_overdue DESC, business_name ASC
    LIMIT $3;
  `;

  const expensesByCategoryQuery = `
    SELECT
      COALESCE(NULLIF(TRIM(e.category), ''), 'Non classe') AS category,
      COUNT(*)::int AS expenses_count,
      COALESCE(SUM(e.amount), 0) AS total_amount
    FROM expenses e
    WHERE e.expense_date BETWEEN $1::date AND $2::date
    GROUP BY COALESCE(NULLIF(TRIM(e.category), ''), 'Non classe')
    ORDER BY total_amount DESC, category ASC
    LIMIT $3;
  `;

  const [
    monthlyTrendResult,
    salesByCityResult,
    salesByPointOfSaleResult,
    salesByWarehouseResult,
    paretoProductsResult,
    marginByProductResult,
    heatmapResult,
    stockCoverageResult,
    receivablesBucketsResult,
    overdueCustomersResult,
    expensesByCategoryResult,
    latestForecasts
  ] = await Promise.all([
    pool.query(monthlyTrendQuery, baseValues),
    pool.query(salesByCityQuery, [...baseValues, topLimit]),
    pool.query(salesByPointOfSaleQuery, [...baseValues, topLimit]),
    pool.query(salesByWarehouseQuery, baseValues),
    pool.query(paretoProductsQuery, [...baseValues, topLimit]),
    pool.query(marginByProductQuery, [...baseValues, topLimit]),
    pool.query(heatmapQuery, [...baseValues, Math.min(topLimit, 10), Math.min(topLimit, 8)]),
    pool.query(stockCoverageQuery, [...baseValues, topLimit]),
    pool.query(receivablesBucketsQuery, [endDate, warehouseId]),
    pool.query(overdueCustomersQuery, [endDate, warehouseId, topLimit]),
    pool.query(expensesByCategoryQuery, [startDate, endDate, topLimit]),
    getAIForecasts({ scenario_label: "baseline", limit: 20 })
  ]);

  const latestSalesForecast =
    latestForecasts.find((row) => row.forecast_domain === "sales") || null;
  const monthlyForecastAmount = latestSalesForecast
    ? roundAmount(
        latestSalesForecast.forecast_payload?.monthly_average_sales ??
          latestSalesForecast.projected_value
      )
    : null;

  const monthlyTrend = monthlyTrendResult.rows.map((row) => ({
    ...row,
    invoiced_amount: roundAmount(row.invoiced_amount),
    payments_received: roundAmount(row.payments_received),
    expenses_amount: roundAmount(row.expenses_amount),
    net_sales_amount: roundAmount(row.net_sales_amount),
    cogs_amount: roundAmount(row.cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    ai_sales_forecast_amount: monthlyForecastAmount
  }));

  const totalSalesBase = monthlyTrend.reduce(
    (sum, row) => sum + Number(row.invoiced_amount || 0),
    0
  );
  const heatmapCells = heatmapResult.rows.map((row) => normalizeHeatmapCellRow(row));
  const heatmapProducts = [
    ...new Map(
      heatmapCells.map((row) => [
        row.product_id,
        {
          product_id: row.product_id,
          product_name: row.product_name,
          category: row.category,
          total_sales_amount: roundAmount(
            heatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            heatmapCells
              .filter((cell) => cell.product_id === row.product_id)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);
  const heatmapCities = [
    ...new Map(
      heatmapCells.map((row) => [
        row.city,
        {
          city: row.city,
          total_sales_amount: roundAmount(
            heatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_sales_amount || 0), 0)
          ),
          total_quantity_sold: roundAmount(
            heatmapCells
              .filter((cell) => cell.city === row.city)
              .reduce((sum, cell) => sum + Number(cell.total_quantity_sold || 0), 0)
          )
        }
      ])
    ).values()
  ].sort((left, right) => right.total_sales_amount - left.total_sales_amount);

  const salesByCity = salesByCityResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalSalesBase)
  );
  const salesByPointOfSale = salesByPointOfSaleResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalSalesBase)
  );
  const salesByWarehouse = salesByWarehouseResult.rows.map((row) =>
    normalizeCommercialAggregateRow(row, totalSalesBase)
  );
  const paretoProducts = paretoProductsResult.rows.map((row) => ({
    ...row,
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: roundAmount(row.total_sales_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    cumulative_sales_share_percent: Number(row.cumulative_sales_share_percent || 0),
    rank_order: Number(row.rank_order || 0)
  }));
  const marginByProduct = marginByProductResult.rows.map((row) => ({
    ...row,
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_amount: roundAmount(row.total_sales_amount),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount),
    allocated_expenses_amount: roundAmount(row.allocated_expenses_amount),
    net_profit_estimate: roundAmount(row.net_profit_estimate),
    net_margin_estimate_percent: Number(row.net_margin_estimate_percent || 0)
  }));
  const stockCoverage = stockCoverageResult.rows.map((row) => ({
    ...row,
    current_stock_quantity: roundAmount(row.current_stock_quantity),
    sold_quantity: roundAmount(row.sold_quantity),
    analysis_days: Number(row.analysis_days || 0),
    avg_daily_sales: roundAmount(row.avg_daily_sales),
    coverage_days:
      row.coverage_days === null ? null : roundAmount(row.coverage_days),
    alert_threshold: roundAmount(row.alert_threshold)
  }));
  const receivablesBucketsRow = receivablesBucketsResult.rows[0] || {};
  const receivablesBuckets = [
    { label: "Non echeu", key: "current_balance", amount: roundAmount(receivablesBucketsRow.current_balance) },
    { label: "1-15 jours", key: "bucket_1_15", amount: roundAmount(receivablesBucketsRow.bucket_1_15) },
    { label: "16-30 jours", key: "bucket_16_30", amount: roundAmount(receivablesBucketsRow.bucket_16_30) },
    { label: "31-60 jours", key: "bucket_31_60", amount: roundAmount(receivablesBucketsRow.bucket_31_60) },
    { label: "60+ jours", key: "bucket_60_plus", amount: roundAmount(receivablesBucketsRow.bucket_60_plus) }
  ];
  const overdueCustomers = overdueCustomersResult.rows.map((row) => ({
    ...row,
    open_invoices_count: Number(row.open_invoices_count || 0),
    max_days_overdue: Number(row.max_days_overdue || 0),
    total_balance_due: roundAmount(row.total_balance_due)
  }));
  const expensesByCategory = expensesByCategoryResult.rows.map((row) => ({
    ...row,
    expenses_count: Number(row.expenses_count || 0),
    total_amount: roundAmount(row.total_amount)
  }));

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      top_limit: topLimit,
      expenses_scope_note:
        warehouseId === null
          ? "Les depenses sont lues au global sur la periode."
          : "Le filtre depot s applique pleinement aux ventes, paiements et stocks. Les depenses restent globales tant qu elles ne sont pas encore affectees a un depot."
    },
    monthly_revenue_trend: monthlyTrend,
    collections_vs_invoices_trend: monthlyTrend,
    ai_forecast_vs_actual: {
      forecast_label: latestSalesForecast?.forecast_type || null,
      confidence_score: latestSalesForecast?.confidence_score
        ? Number(latestSalesForecast.confidence_score)
        : null,
      rows: monthlyTrend
    },
    sales_by_city: salesByCity,
    sales_by_point_of_sale: salesByPointOfSale,
    sales_by_warehouse: salesByWarehouse,
    product_pareto: paretoProducts,
    net_margin_by_product: marginByProduct,
    point_of_sale_map: salesByCity,
    product_city_heatmap: {
      products: heatmapProducts,
      cities: heatmapCities,
      cells: heatmapCells
    },
    stock_coverage: stockCoverage,
    receivables_aging: {
      summary: {
        open_invoices_count: Number(receivablesBucketsRow.open_invoices_count || 0),
        total_balance_due: roundAmount(receivablesBucketsRow.total_balance_due)
      },
      buckets: receivablesBuckets,
      overdue_customers: overdueCustomers
    },
    expenses_by_category: expensesByCategory
  };
}

export async function getAccountingMonthlyOverview() {
  const query = `
    WITH period_series AS (
      SELECT
        month_start,
        half_index,
        CASE
          WHEN half_index = 1 THEN month_start
          ELSE month_start + INTERVAL '15 days'
        END::date AS period_start,
        CASE
          WHEN half_index = 1 THEN month_start + INTERVAL '14 days'
          ELSE (month_start + INTERVAL '1 month' - INTERVAL '1 day')
        END::date AS period_end
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      ) AS month_series(month_start)
      CROSS JOIN generate_series(1, 2) AS halves(half_index)
    ),
    entry_periods AS (
      SELECT
        CASE
          WHEN EXTRACT(DAY FROM je.entry_date) <= 15
            THEN DATE_TRUNC('month', je.entry_date)::date
          ELSE (DATE_TRUNC('month', je.entry_date) + INTERVAL '15 days')::date
        END AS period_start,
        COUNT(DISTINCT je.id)::int AS total_entries,
        COALESCE(SUM(jel.debit), 0) AS total_debit,
        COALESCE(SUM(jel.credit), 0) AS total_credit
      FROM journal_entries je
      INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      WHERE je.status = 'posted'
        AND je.entry_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY
        CASE
          WHEN EXTRACT(DAY FROM je.entry_date) <= 15
            THEN DATE_TRUNC('month', je.entry_date)::date
          ELSE (DATE_TRUNC('month', je.entry_date) + INTERVAL '15 days')::date
        END
    )
    SELECT
      TO_CHAR(ps.month_start, 'YYYY-MM') || '-H' || ps.half_index AS period,
      TO_CHAR(ps.month_start, 'YYYY-MM') AS month_period,
      ps.half_index AS period_half,
      TO_CHAR(ps.period_start, 'YYYY-MM-DD') AS period_start,
      TO_CHAR(ps.period_end, 'YYYY-MM-DD') AS period_end,
      COALESCE(ep.total_entries, 0) AS total_entries,
      COALESCE(ep.total_debit, 0) AS total_debit,
      COALESCE(ep.total_credit, 0) AS total_credit
    FROM period_series ps
    LEFT JOIN entry_periods ep ON ep.period_start = ps.period_start
    ORDER BY ps.period_start ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getAccountClassBalances() {
  const query = `
    SELECT
      a.account_class,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit,
      COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) AS balance
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE a.is_active = TRUE
      AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.account_class
    ORDER BY a.account_class ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getRecentJournalEntries(limit = 10) {
  const query = `
    SELECT
      je.id,
      je.entry_number,
      je.entry_date,
      je.journal_code,
      je.description,
      je.status,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit,
      COUNT(jel.id)::int AS lines_count
    FROM journal_entries je
    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    GROUP BY je.id
    ORDER BY je.created_at DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getStockVariationOverview(filters = {}) {
  const { whereClause, values } = buildStockMovementFilters(filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_movements,
      COUNT(DISTINCT sm.product_id)::int AS total_products,
      COUNT(DISTINCT sm.warehouse_id)::int AS total_warehouses,
      MIN(sm.created_at) AS first_movement_at,
      MAX(sm.created_at) AS last_movement_at,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('IN', 'TRANSFER_IN', 'PRODUCTION_OUTPUT', 'TRANSFORM_IN', 'MIXTURE_IN')
          THEN sm.quantity
        ELSE 0
      END), 0) AS total_positive_quantity,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('OUT', 'TRANSFER_OUT', 'PRODUCTION_CONSUME', 'TRANSFORM_OUT', 'MIXTURE_OUT')
          THEN sm.quantity
        ELSE 0
      END), 0) AS total_negative_quantity,
      COALESCE(SUM(CASE
        WHEN sm.movement_type = 'ADJUSTMENT'
          THEN sm.quantity
        ELSE 0
      END), 0) AS total_adjusted_quantity
    FROM stock_movements sm
    ${whereClause};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows[0];
}

export async function getStockVariationByMovementType(filters = {}) {
  const { whereClause, values } = buildStockMovementFilters(filters);

  const query = `
    SELECT
      sm.movement_type,
      COUNT(*)::int AS movements_count,
      COALESCE(SUM(sm.quantity), 0) AS total_quantity
    FROM stock_movements sm
    ${whereClause}
    GROUP BY sm.movement_type
    ORDER BY movements_count DESC, total_quantity DESC, sm.movement_type ASC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows;
}

export async function getStockVariationByProduct(filters = {}, limit = 10) {
  const { whereClause, values } = buildStockMovementFilters(filters);
  values.push(limit);

  const query = `
    SELECT
      sm.product_id,
      p.name AS product_name,
      p.sku,
      p.product_role,
      p.unit,
      COUNT(*)::int AS movements_count,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('IN', 'TRANSFER_IN', 'PRODUCTION_OUTPUT', 'TRANSFORM_IN', 'MIXTURE_IN')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_in,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('OUT', 'TRANSFER_OUT', 'PRODUCTION_CONSUME', 'TRANSFORM_OUT', 'MIXTURE_OUT')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_out,
      COALESCE(SUM(CASE
        WHEN sm.movement_type = 'ADJUSTMENT'
          THEN sm.quantity
        ELSE 0
      END), 0) AS adjusted_quantity
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    ${whereClause}
    GROUP BY sm.product_id, p.name, p.sku, p.product_role, p.unit
    ORDER BY movements_count DESC, quantity_in DESC, product_name ASC
    LIMIT $${values.length};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows;
}

export async function getStockVariationByWarehouse(filters = {}, limit = 10) {
  const { whereClause, values } = buildStockMovementFilters(filters);
  values.push(limit);

  const query = `
    SELECT
      sm.warehouse_id,
      w.name AS warehouse_name,
      w.city AS warehouse_city,
      COUNT(*)::int AS movements_count,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('IN', 'TRANSFER_IN', 'PRODUCTION_OUTPUT', 'TRANSFORM_IN', 'MIXTURE_IN')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_in,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('OUT', 'TRANSFER_OUT', 'PRODUCTION_CONSUME', 'TRANSFORM_OUT', 'MIXTURE_OUT')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_out,
      COALESCE(SUM(CASE
        WHEN sm.movement_type = 'ADJUSTMENT'
          THEN sm.quantity
        ELSE 0
      END), 0) AS adjusted_quantity
    FROM stock_movements sm
    INNER JOIN warehouses w ON w.id = sm.warehouse_id
    ${whereClause}
    GROUP BY sm.warehouse_id, w.name, w.city
    ORDER BY movements_count DESC, quantity_in DESC, warehouse_name ASC
    LIMIT $${values.length};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows;
}

export async function getStockVariationTimeline(
  filters = {},
  granularity = "day"
) {
  const periodExpression =
    granularity === "month"
      ? `TO_CHAR(sm.created_at, 'YYYY-MM')`
      : `TO_CHAR(sm.created_at, 'YYYY-MM-DD')`;

  const { whereClause, values } = buildStockMovementFilters(filters);

  const query = `
    SELECT
      ${periodExpression} AS period,
      COUNT(*)::int AS movements_count,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('IN', 'TRANSFER_IN', 'PRODUCTION_OUTPUT', 'TRANSFORM_IN', 'MIXTURE_IN')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_in,
      COALESCE(SUM(CASE
        WHEN sm.movement_type IN ('OUT', 'TRANSFER_OUT', 'PRODUCTION_CONSUME', 'TRANSFORM_OUT', 'MIXTURE_OUT')
          THEN sm.quantity
        ELSE 0
      END), 0) AS quantity_out,
      COALESCE(SUM(CASE
        WHEN sm.movement_type = 'ADJUSTMENT'
          THEN sm.quantity
        ELSE 0
      END), 0) AS adjusted_quantity
    FROM stock_movements sm
    ${whereClause}
    GROUP BY period
    ORDER BY period ASC;
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows;
}

export async function getRecentStockVariationMovements(filters = {}, limit = 20) {
  const { whereClause, values } = buildStockMovementFilters(filters);
  values.push(limit);

  const query = `
    SELECT
      sm.id,
      sm.product_id,
      sm.warehouse_id,
      sm.movement_type,
      sm.quantity,
      sm.stock_form,
      sm.package_size,
      sm.package_unit,
      sm.unit_cost,
      sm.reference_type,
      sm.reference_id,
      sm.notes,
      sm.created_at,
      p.name AS product_name,
      p.sku,
      p.unit,
      w.name AS warehouse_name,
      w.city AS warehouse_city
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    INNER JOIN warehouses w ON w.id = sm.warehouse_id
    ${whereClause}
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT $${values.length};
  `;

  const result = await queryWithSchemaOrColumnRetry({
    executor: (sql, params = []) => pool.query(sql, params),
    ensureSchema: () => ensureDashboardSchema(pool),
    query,
    values
  });
  return result.rows;
}
