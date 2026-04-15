import { pool } from "../config/db.js";

export async function getGlobalStats() {
  const query = `
    SELECT
      (SELECT COUNT(*)::int FROM products WHERE is_active = TRUE) AS total_products,
      (SELECT COUNT(*)::int FROM customers WHERE is_active = TRUE) AS total_customers,
      (SELECT COUNT(*)::int FROM warehouses) AS total_warehouses,
      (SELECT COUNT(*)::int FROM invoices) AS total_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'paid') AS paid_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'partial') AS partial_invoices,
      (SELECT COUNT(*)::int FROM invoices WHERE status = 'issued') AS unpaid_invoices,
      (SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE status IN ('issued', 'partial', 'paid')) AS total_sales_amount,
      (SELECT COALESCE(SUM(paid_amount), 0) FROM invoices WHERE status IN ('issued', 'partial', 'paid')) AS total_collected_amount,
      (SELECT COALESCE(SUM(balance_due), 0) FROM invoices WHERE status IN ('issued', 'partial')) AS total_receivables,
      (SELECT COALESCE(SUM(amount), 0) FROM payments) AS total_payments_received,
      (SELECT COALESCE(SUM(quantity), 0) FROM warehouse_stock) AS total_units_in_stock;
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
      SUM(ii.line_total) AS total_sales_value
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
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.status,
      i.total_amount,
      i.paid_amount,
      i.balance_due,
      c.business_name AS customer_name,
      w.name AS warehouse_name
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
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
      TO_CHAR(invoice_date, 'YYYY-MM') AS period,
      COUNT(*)::int AS total_invoices,
      COALESCE(SUM(total_amount), 0) AS total_sales,
      COALESCE(SUM(paid_amount), 0) AS total_collected,
      COALESCE(SUM(balance_due), 0) AS total_due
    FROM invoices
    WHERE status IN ('issued', 'partial', 'paid')
    GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
    ORDER BY period ASC;
  `;

  const result = await pool.query(query);
  return result.rows;
}

export async function getSalesByWarehouse() {
  const query = `
    SELECT
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      w.city,
      COUNT(i.id)::int AS total_invoices,
      COALESCE(SUM(i.total_amount), 0) AS total_sales,
      COALESCE(SUM(i.paid_amount), 0) AS total_collected,
      COALESCE(SUM(i.balance_due), 0) AS total_due
    FROM warehouses w
    LEFT JOIN invoices i ON i.warehouse_id = w.id
    GROUP BY w.id, w.name, w.city
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