import { pool } from "../config/db.js";
import { ensurePurchaseInvoicesSchema } from "./purchaseInvoice.model.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function ensureReportsSchema(executor = pool) {
  await ensurePurchaseInvoicesSchema(executor);
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
      p.unit,
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
