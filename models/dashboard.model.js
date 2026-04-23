import { pool } from "../config/db.js";

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
    SELECT
      TO_CHAR(i.invoice_date, 'YYYY-MM') AS period,
      COUNT(DISTINCT i.id)::int AS total_invoices,
      COALESCE(SUM(DISTINCT i.total_amount), 0) AS total_sales,
      COALESCE(SUM(DISTINCT (i.total_amount - COALESCE(i.tax_amount, 0))), 0) AS total_net_sales,
      COALESCE(SUM(DISTINCT i.paid_amount), 0) AS total_collected,
      COALESCE(SUM(DISTINCT i.balance_due), 0) AS total_due,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs,
      COALESCE(SUM(DISTINCT (i.total_amount - COALESCE(i.tax_amount, 0))), 0)
        - COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS gross_profit
    FROM invoices i
    LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE i.status IN ('issued', 'partial', 'paid')
    GROUP BY TO_CHAR(i.invoice_date, 'YYYY-MM')
    ORDER BY period ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
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

export async function getAccountingMonthlyOverview() {
  const query = `
    SELECT
      TO_CHAR(je.entry_date, 'YYYY-MM') AS period,
      COUNT(DISTINCT je.id)::int AS total_entries,
      COALESCE(SUM(jel.debit), 0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM journal_entries je
    INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
    WHERE je.status = 'posted'
    GROUP BY TO_CHAR(je.entry_date, 'YYYY-MM')
    ORDER BY period ASC;
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

  const result = await pool.query(query, values);
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

  const result = await pool.query(query, values);
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
    GROUP BY sm.product_id, p.name, p.sku, p.unit
    ORDER BY movements_count DESC, quantity_in DESC, product_name ASC
    LIMIT $${values.length};
  `;

  const result = await pool.query(query, values);
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

  const result = await pool.query(query, values);
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

  const result = await pool.query(query, values);
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

  const result = await pool.query(query, values);
  return result.rows;
}
