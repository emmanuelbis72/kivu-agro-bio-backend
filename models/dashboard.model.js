import { pool } from "../config/db.js";
import { queryWithSchemaOrColumnRetry } from "../utils/schemaSelfHealing.util.js";
import { ensurePurchaseInvoicesSchema } from "./purchaseInvoice.model.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function ensureDashboardSchema(executor = pool) {
  await executor.query(`
    ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_role VARCHAR(30) NOT NULL DEFAULT 'finished_product';
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

export async function getExecutiveComparisonTimeline(months = 12) {
  const safeMonths = Math.min(Math.max(Number(months || 12), 3), 24);
  const query = `
    WITH month_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month'),
        DATE_TRUNC('month', CURRENT_DATE),
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
      GROUP BY DATE_TRUNC('month', i.invoice_date)
    ),
    payment_monthly AS (
      SELECT
        DATE_TRUNC('month', p.payment_date)::date AS month_start,
        COALESCE(SUM(p.amount), 0) AS payments_received
      FROM payments p
      WHERE p.payment_date >= DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', p.payment_date)
    ),
    expense_monthly AS (
      SELECT
        DATE_TRUNC('month', e.expense_date)::date AS month_start,
        COALESCE(SUM(e.amount), 0) AS expenses_amount
      FROM expenses e
      WHERE e.expense_date >= DATE_TRUNC('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY DATE_TRUNC('month', e.expense_date)
    )
    SELECT
      TO_CHAR(ms.month_start, 'YYYY-MM') AS period,
      COALESCE(im.total_invoices, 0) AS total_invoices,
      COALESCE(im.invoiced_amount, 0) AS invoiced_amount,
      COALESCE(pm.payments_received, 0) AS payments_received,
      COALESCE(em.expenses_amount, 0) AS expenses_amount,
      COALESCE(im.gross_profit_amount, 0) AS gross_profit_amount,
      COALESCE(im.net_sales_amount, 0) AS net_sales_amount,
      COALESCE(im.cogs_amount, 0) AS cogs_amount
    FROM month_series ms
    LEFT JOIN invoice_monthly im ON im.month_start = ms.month_start
    LEFT JOIN payment_monthly pm ON pm.month_start = ms.month_start
    LEFT JOIN expense_monthly em ON em.month_start = ms.month_start
    ORDER BY ms.month_start ASC;
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
    actual_cash AS (
      SELECT
        COALESCE((SELECT SUM(amount) FROM payments), 0) AS total_customer_receipts,
        COALESCE((SELECT SUM(amount) FROM supplier_payments), 0) AS total_supplier_payments,
        COALESCE((SELECT SUM(amount) FROM expenses), 0) AS total_expenses
    )
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
      (
        a.total_customer_receipts
        - a.total_supplier_payments
        - a.total_expenses
      ) AS current_cash_base
    FROM receivables r
    CROSS JOIN payables p
    CROSS JOIN actual_cash a;
  `;

  const horizonsQuery = `
    WITH actual_cash AS (
      SELECT
        COALESCE((SELECT SUM(amount) FROM payments), 0) AS total_customer_receipts,
        COALESCE((SELECT SUM(amount) FROM supplier_payments), 0) AS total_supplier_payments,
        COALESCE((SELECT SUM(amount) FROM expenses), 0) AS total_expenses
    ),
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

export async function getCommercialDashboard(periodDays = 365, topLimit = 10) {
  await ensureDashboardSchema(pool);

  const summaryQuery = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    ),
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
        c.city AS customer_city,
        COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount
      FROM invoices i
      INNER JOIN customers c ON c.id = i.customer_id
      LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    )
    SELECT
      COUNT(*)::int AS total_invoices,
      COUNT(DISTINCT customer_id)::int AS active_customers,
      COUNT(DISTINCT warehouse_id)::int AS active_warehouses,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(customer_city), ''), 'Non renseignee'))::int AS active_cities,
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
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      TO_CHAR(i.invoice_date, 'YYYY-MM') AS period,
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
      AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
    GROUP BY TO_CHAR(i.invoice_date, 'YYYY-MM')
    ORDER BY period ASC;
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
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
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
      COUNT(i.id)::int AS total_invoices,
      COUNT(DISTINCT i.customer_id)::int AS total_customers,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM warehouses w
    LEFT JOIN invoices i
      ON i.warehouse_id = w.id
      AND i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    GROUP BY w.id, w.name, w.city
    ORDER BY total_sales_amount DESC, warehouse_name ASC;
  `;

  const salesByCustomerQuery = `
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
      c.city,
      COUNT(i.id)::int AS total_invoices,
      MAX(i.invoice_date) AS last_invoice_date,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM customers c
    INNER JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY c.id, c.business_name, c.city
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

  const topPayingCustomersQuery = `
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
      c.city,
      COUNT(i.id)::int AS total_invoices,
      MAX(i.invoice_date) AS last_invoice_date,
      COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
      COALESCE(SUM(i.balance_due), 0) AS total_receivables,
      COALESCE(SUM(COALESCE(ic.total_cogs_amount, 0)), 0) AS total_cogs_amount,
      COALESCE(
        SUM((i.total_amount - COALESCE(i.tax_amount, 0)) - COALESCE(ic.total_cogs_amount, 0)),
        0
      ) AS gross_profit_amount
    FROM customers c
    INNER JOIN invoices i ON i.customer_id = c.id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
      AND i.invoice_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
    GROUP BY c.id, c.business_name, c.city
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
    WITH month_series AS (
      SELECT generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        INTERVAL '1 month'
      )::date AS month_start
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
    billed_monthly AS (
      SELECT
        i.customer_id,
        DATE_TRUNC('month', i.invoice_date)::date AS month_start,
        COALESCE(SUM(i.total_amount), 0) AS billed_amount
      FROM invoices i
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY i.customer_id, DATE_TRUNC('month', i.invoice_date)
    ),
    paid_monthly AS (
      SELECT
        i.customer_id,
        DATE_TRUNC('month', p.payment_date)::date AS month_start,
        COALESCE(SUM(p.amount), 0) AS payments_received
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.payment_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
      GROUP BY i.customer_id, DATE_TRUNC('month', p.payment_date)
    )
    SELECT
      TO_CHAR(ms.month_start, 'YYYY-MM') AS period,
      tc.customer_id,
      tc.business_name,
      COALESCE(bm.billed_amount, 0) AS billed_amount,
      COALESCE(pm.payments_received, 0) AS payments_received
    FROM top_customers tc
    CROSS JOIN month_series ms
    LEFT JOIN billed_monthly bm
      ON bm.customer_id = tc.customer_id
     AND bm.month_start = ms.month_start
    LEFT JOIN paid_monthly pm
      ON pm.customer_id = tc.customer_id
     AND pm.month_start = ms.month_start
    ORDER BY tc.business_name ASC, ms.month_start ASC;
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
    WITH customer_stats AS (
      SELECT
        c.id AS customer_id,
        c.business_name,
        c.city,
        MAX(i.invoice_date) AS last_invoice_date,
        COUNT(i.id)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM customers c
      INNER JOIN invoices i ON i.customer_id = c.id
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY c.id, c.business_name, c.city
    )
    SELECT
      customer_id,
      business_name,
      city,
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
    WITH customer_stats AS (
      SELECT
        c.id AS customer_id,
        c.business_name,
        c.city,
        MAX(i.invoice_date) AS last_invoice_date,
        COUNT(i.id)::int AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM customers c
      INNER JOIN invoices i ON i.customer_id = c.id
      WHERE i.status IN ('issued', 'partial', 'paid')
      GROUP BY c.id, c.business_name, c.city
    )
    SELECT
      customer_id,
      business_name,
      city,
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
    salesByCustomerResult,
    salesByProductResult,
    topPayingCustomersResult,
    mostProfitableProductsResult,
    customerMonthlyTrendResult,
    decliningProductsResult,
    dormantClientsResult,
    reactivationCandidatesResult
  ] = await Promise.all([
    pool.query(summaryQuery, [periodDays]),
    pool.query(monthlyTrendQuery),
    pool.query(salesByCityQuery, [periodDays, topLimit]),
    pool.query(salesByWarehouseQuery, [periodDays]),
    pool.query(salesByCustomerQuery, [periodDays, topLimit]),
    pool.query(salesByProductQuery, [periodDays, topLimit]),
    pool.query(topPayingCustomersQuery, [periodDays, topLimit]),
    pool.query(mostProfitableProductsQuery, [periodDays, topLimit]),
    pool.query(customerMonthlyTrendQuery, [Math.min(topLimit, 5)]),
    pool.query(decliningProductsQuery, [topLimit]),
    pool.query(dormantClientsQuery, [45, topLimit]),
    pool.query(reactivationCandidatesQuery, [topLimit])
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    filters: {
      period_days: Number(periodDays || 0),
      top_limit: Number(topLimit || 0),
      dormant_days: 45,
      reactivation_days: 30
    },
    summary: {
      total_invoices: Number(summary.total_invoices || 0),
      active_customers: Number(summary.active_customers || 0),
      active_warehouses: Number(summary.active_warehouses || 0),
      active_cities: Number(summary.active_cities || 0),
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
    sales_by_city: salesByCityResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_customers: Number(row.total_customers || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount)
    })),
    sales_by_warehouse: salesByWarehouseResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_customers: Number(row.total_customers || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount)
    })),
    sales_by_customer: salesByCustomerResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount)
    })),
    sales_by_product: salesByProductResult.rows.map((row) => ({
      ...row,
      total_quantity_sold: roundAmount(row.total_quantity_sold),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount),
      gross_margin_percent: Number(row.gross_margin_percent || 0)
    })),
    top_paying_customers: topPayingCustomersResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount)
    })),
    most_profitable_products: mostProfitableProductsResult.rows.map((row) => ({
      ...row,
      total_quantity_sold: roundAmount(row.total_quantity_sold),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_cogs_amount: roundAmount(row.total_cogs_amount),
      gross_profit_amount: roundAmount(row.gross_profit_amount),
      gross_margin_percent: Number(row.gross_margin_percent || 0)
    })),
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
    dormant_clients: dormantClientsResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      days_since_last_invoice: Number(row.days_since_last_invoice || 0)
    })),
    reactivation_candidates: reactivationCandidatesResult.rows.map((row) => ({
      ...row,
      total_invoices: Number(row.total_invoices || 0),
      total_sales_amount: roundAmount(row.total_sales_amount),
      total_collected_amount: roundAmount(row.total_collected_amount),
      total_receivables: roundAmount(row.total_receivables),
      days_since_last_invoice: Number(row.days_since_last_invoice || 0)
    }))
  };
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
