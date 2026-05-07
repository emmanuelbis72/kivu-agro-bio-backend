import { pool } from "../config/db.js";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance
} from "./accountingReport.model.js";
import {
  getAccountingHealthSnapshot,
  getLowRotationProducts,
  getStockAlerts
} from "./dashboard.model.js";
import { ensurePurchaseInvoicesSchema } from "./purchaseInvoice.model.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function formatIsoDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildMonthRange(year, month) {
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0));

  return {
    start_date: formatIsoDate(startDate),
    end_date: formatIsoDate(endDate),
    period_label: new Intl.DateTimeFormat("fr-FR", {
      month: "long",
      year: "numeric"
    }).format(new Date(year, month - 1, 1))
  };
}

function addDaysToIsoDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function buildCloseChecklist(summary, accountingSnapshot) {
  const items = [
    {
      key: "customer_invoices_accounted",
      label: "Factures clients du mois comptabilisees",
      status:
        Number(accountingSnapshot.invoices_to_fix || 0) === 0
          ? "done"
          : "critical",
      detail:
        Number(accountingSnapshot.invoices_to_fix || 0) === 0
          ? "Aucune facture client du mois en attente de comptabilisation."
          : `${Number(
              accountingSnapshot.invoices_to_fix || 0
            )} facture(s) client du mois restent a comptabiliser.`
    },
    {
      key: "customer_payments_accounted",
      label: "Paiements clients du mois comptabilises",
      status:
        Number(accountingSnapshot.payments_to_fix || 0) === 0
          ? "done"
          : "critical",
      detail:
        Number(accountingSnapshot.payments_to_fix || 0) === 0
          ? "Tous les paiements clients du mois sont postes."
          : `${Number(
              accountingSnapshot.payments_to_fix || 0
            )} paiement(s) client du mois restent a comptabiliser.`
    },
    {
      key: "expenses_accounted",
      label: "Depenses du mois comptabilisees",
      status:
        Number(accountingSnapshot.expenses_to_fix || 0) === 0
          ? "done"
          : "critical",
      detail:
        Number(accountingSnapshot.expenses_to_fix || 0) === 0
          ? "Toutes les depenses du mois sont comptabilisees."
          : `${Number(
              accountingSnapshot.expenses_to_fix || 0
            )} depense(s) du mois restent a comptabiliser.`
    },
    {
      key: "supplier_documents_accounted",
      label: "Achats et reglements fournisseurs postes",
      status:
        Number(accountingSnapshot.purchase_invoices_to_fix || 0) === 0 &&
        Number(accountingSnapshot.supplier_payments_to_fix || 0) === 0
          ? "done"
          : "critical",
      detail:
        Number(accountingSnapshot.purchase_invoices_to_fix || 0) === 0 &&
        Number(accountingSnapshot.supplier_payments_to_fix || 0) === 0
          ? "Factures fournisseurs et paiements fournisseurs du mois postes."
          : `${Number(
              accountingSnapshot.purchase_invoices_to_fix || 0
            )} facture(s) fournisseur et ${Number(
              accountingSnapshot.supplier_payments_to_fix || 0
            )} paiement(s) fournisseur du mois restent a regulariser.`
    },
    {
      key: "draft_entries",
      label: "Aucune ecriture brouillon sur le mois",
      status:
        Number(accountingSnapshot.draft_entries || 0) === 0
          ? "done"
          : "attention",
      detail:
        Number(accountingSnapshot.draft_entries || 0) === 0
          ? "Aucune ecriture brouillon datee sur la periode."
          : `${Number(
              accountingSnapshot.draft_entries || 0
            )} ecriture(s) brouillon restent ouvertes sur le mois.`
    },
    {
      key: "imbalanced_entries",
      label: "Aucune ecriture desequilibree sur le mois",
      status:
        Number(accountingSnapshot.imbalanced_entries || 0) === 0
          ? "done"
          : "critical",
      detail:
        Number(accountingSnapshot.imbalanced_entries || 0) === 0
          ? "Toutes les ecritures du mois sont equilibrees."
          : `${Number(
              accountingSnapshot.imbalanced_entries || 0
            )} ecriture(s) du mois sont desequilibrees.`
    },
    {
      key: "overdue_receivables",
      label: "Creances echees a la cloture",
      status:
        Number(summary.overdue_receivables_at_close || 0) === 0
          ? "done"
          : "attention",
      detail:
        Number(summary.overdue_receivables_at_close || 0) === 0
          ? "Aucune creance echee a la date de cloture."
          : `${roundAmount(
              summary.overdue_receivables_at_close
            )} $US de creances etaient deja echees a la cloture.`
    },
    {
      key: "overdue_payables",
      label: "Dettes fournisseurs echees a la cloture",
      status:
        Number(summary.overdue_payables_at_close || 0) === 0
          ? "done"
          : "attention",
      detail:
        Number(summary.overdue_payables_at_close || 0) === 0
          ? "Aucune dette fournisseur echee a la date de cloture."
          : `${roundAmount(
              summary.overdue_payables_at_close
            )} $US de dettes etaient deja echees a la cloture.`
    },
    {
      key: "stock_alerts",
      label: "Alertes stock actives au moment du pack",
      status:
        Number(summary.current_stock_alerts_count || 0) === 0
          ? "done"
          : "attention",
      detail:
        Number(summary.current_stock_alerts_count || 0) === 0
          ? "Aucune alerte stock active."
          : `${Number(
              summary.current_stock_alerts_count || 0
            )} ligne(s) de stock sont actuellement sous seuil.`
    }
  ];

  const criticalCount = items.filter((item) => item.status === "critical").length;
  const attentionCount = items.filter(
    (item) => item.status === "attention"
  ).length;

  return {
    close_status:
      criticalCount > 0 ? "blocked" : attentionCount > 0 ? "attention" : "ready",
    critical_count: criticalCount,
    attention_count: attentionCount,
    items
  };
}

export async function getMonthlyClosePack({
  year,
  month,
  detailLimit = 10
}) {
  await ensurePurchaseInvoicesSchema(pool);

  const safeDetailLimit = Math.min(Math.max(Number(detailLimit) || 10, 1), 100);
  const period = buildMonthRange(Number(year), Number(month));
  const horizon60Date = addDaysToIsoDate(period.end_date, 60);

  const summaryQuery = `
    WITH invoice_cogs_period AS (
      SELECT
        i.id,
        COALESCE(i.total_amount, 0) AS total_amount,
        COALESCE(i.tax_amount, 0) AS tax_amount,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoices i
      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE COALESCE(i.status, 'issued') <> 'cancelled'
        AND i.invoice_date BETWEEN $2::date AND $1::date
      GROUP BY i.id, i.total_amount, i.tax_amount
    ),
    customer_payment_totals AS (
      SELECT
        p.invoice_id,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM payments p
      GROUP BY p.invoice_id
    ),
    invoice_balances AS (
      SELECT
        i.id,
        i.customer_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        COALESCE(i.total_amount, 0) AS total_amount,
        GREATEST(
          COALESCE(i.total_amount, 0) - COALESCE(cpt.paid_to_cutoff, 0),
          0
        ) AS balance_due
      FROM invoices i
      LEFT JOIN customer_payment_totals cpt ON cpt.invoice_id = i.id
      WHERE COALESCE(i.status, 'issued') <> 'cancelled'
        AND i.invoice_date <= $1::date
    ),
    supplier_payment_totals AS (
      SELECT
        sp.purchase_invoice_id,
        COALESCE(SUM(sp.amount) FILTER (WHERE sp.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM supplier_payments sp
      GROUP BY sp.purchase_invoice_id
    ),
    purchase_balances AS (
      SELECT
        pi.id,
        pi.supplier_id,
        pi.purchase_invoice_number,
        pi.invoice_date,
        pi.due_date,
        COALESCE(pi.total_amount, 0) AS total_amount,
        GREATEST(
          COALESCE(pi.total_amount, 0) - COALESCE(spt.paid_to_cutoff, 0),
          0
        ) AS balance_due
      FROM purchase_invoices pi
      LEFT JOIN supplier_payment_totals spt
        ON spt.purchase_invoice_id = pi.id
      WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
        AND pi.invoice_date <= $1::date
    ),
    stock_snapshot AS (
      SELECT
        COUNT(*) FILTER (
          WHERE ws.quantity <= COALESCE(p.alert_threshold, 0)
        )::int AS stock_alerts_count,
        COALESCE(SUM(ws.quantity * COALESCE(p.cost_price, 0)), 0) AS stock_value
      FROM warehouse_stock ws
      INNER JOIN products p ON p.id = ws.product_id
    )
    SELECT
      (SELECT COUNT(*)::int
       FROM invoices i
       WHERE COALESCE(i.status, 'issued') <> 'cancelled'
         AND i.invoice_date BETWEEN $2::date AND $1::date) AS period_invoices_count,
      (SELECT COALESCE(SUM(i.total_amount), 0)
       FROM invoices i
       WHERE COALESCE(i.status, 'issued') <> 'cancelled'
         AND i.invoice_date BETWEEN $2::date AND $1::date) AS period_sales_amount,
      (SELECT COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0)
       FROM invoices i
       WHERE COALESCE(i.status, 'issued') <> 'cancelled'
         AND i.invoice_date BETWEEN $2::date AND $1::date) AS period_net_sales_amount,
      (SELECT COALESCE(SUM(total_cogs_amount), 0)
       FROM invoice_cogs_period) AS period_cogs_amount,
      (SELECT COALESCE(SUM((total_amount - tax_amount) - total_cogs_amount), 0)
       FROM invoice_cogs_period) AS period_gross_profit_amount,
      (SELECT COUNT(*)::int
       FROM purchase_invoices pi
       WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
         AND pi.invoice_date BETWEEN $2::date AND $1::date) AS period_purchase_invoices_count,
      (SELECT COALESCE(SUM(pi.total_amount), 0)
       FROM purchase_invoices pi
       WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
         AND pi.invoice_date BETWEEN $2::date AND $1::date) AS period_purchases_amount,
      (SELECT COUNT(*)::int
       FROM payments p
       WHERE p.payment_date BETWEEN $2::date AND $1::date) AS period_customer_payments_count,
      (SELECT COALESCE(SUM(p.amount), 0)
       FROM payments p
       WHERE p.payment_date BETWEEN $2::date AND $1::date) AS period_collections_amount,
      (SELECT COUNT(*)::int
       FROM supplier_payments sp
       WHERE sp.payment_date BETWEEN $2::date AND $1::date) AS period_supplier_payments_count,
      (SELECT COALESCE(SUM(sp.amount), 0)
       FROM supplier_payments sp
       WHERE sp.payment_date BETWEEN $2::date AND $1::date) AS period_supplier_payments_amount,
      (SELECT COUNT(*)::int
       FROM expenses e
       WHERE e.expense_date BETWEEN $2::date AND $1::date) AS period_expenses_count,
      (SELECT COALESCE(SUM(e.amount), 0)
       FROM expenses e
       WHERE e.expense_date BETWEEN $2::date AND $1::date) AS period_expenses_amount,
      (SELECT COUNT(*)::int
       FROM invoice_balances
       WHERE balance_due > 0) AS open_receivables_count,
      (SELECT COALESCE(SUM(balance_due), 0)
       FROM invoice_balances
       WHERE balance_due > 0) AS receivables_at_close,
      (SELECT COALESCE(SUM(balance_due), 0)
       FROM invoice_balances
       WHERE balance_due > 0
         AND due_date IS NOT NULL
         AND due_date < $1::date) AS overdue_receivables_at_close,
      (SELECT COUNT(*)::int
       FROM purchase_balances
       WHERE balance_due > 0) AS open_payables_count,
      (SELECT COALESCE(SUM(balance_due), 0)
       FROM purchase_balances
       WHERE balance_due > 0) AS payables_at_close,
      (SELECT COALESCE(SUM(balance_due), 0)
       FROM purchase_balances
       WHERE balance_due > 0
         AND due_date IS NOT NULL
         AND due_date < $1::date) AS overdue_payables_at_close,
      (
        COALESCE((SELECT SUM(amount) FROM payments WHERE payment_date <= $1::date), 0)
        - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE payment_date <= $1::date), 0)
        - COALESCE((SELECT SUM(amount) FROM expenses WHERE expense_date <= $1::date), 0)
      ) AS cash_base_at_close,
      (SELECT stock_alerts_count FROM stock_snapshot) AS current_stock_alerts_count,
      (SELECT stock_value FROM stock_snapshot) AS current_stock_value;
  `;

  const accountingSnapshotQuery = `
    SELECT
      (SELECT COUNT(*)::int
       FROM invoices i
       WHERE COALESCE(i.status, 'issued') <> 'cancelled'
         AND i.invoice_date BETWEEN $1::date AND $2::date
         AND (
           i.accounting_entry_id IS NULL
           OR COALESCE(i.accounting_status, '') <> 'posted'
         )) AS invoices_to_fix,
      (SELECT COUNT(*)::int
       FROM payments p
       WHERE p.payment_date BETWEEN $1::date AND $2::date
         AND (
           p.accounting_entry_id IS NULL
           OR COALESCE(p.accounting_status, '') <> 'posted'
         )) AS payments_to_fix,
      (SELECT COUNT(*)::int
       FROM expenses e
       WHERE e.expense_date BETWEEN $1::date AND $2::date
         AND (
           e.accounting_entry_id IS NULL
           OR COALESCE(e.accounting_status, '') <> 'posted'
         )) AS expenses_to_fix,
      (SELECT COUNT(*)::int
       FROM purchase_invoices pi
       WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
         AND pi.invoice_date BETWEEN $1::date AND $2::date
         AND (
           pi.accounting_entry_id IS NULL
           OR COALESCE(pi.accounting_status, '') <> 'posted'
         )) AS purchase_invoices_to_fix,
      (SELECT COUNT(*)::int
       FROM supplier_payments sp
       WHERE sp.payment_date BETWEEN $1::date AND $2::date
         AND (
           sp.accounting_entry_id IS NULL
           OR COALESCE(sp.accounting_status, '') <> 'posted'
         )) AS supplier_payments_to_fix,
      (SELECT COUNT(*)::int
       FROM journal_entries je
       WHERE je.entry_date BETWEEN $1::date AND $2::date) AS total_entries,
      (SELECT COUNT(*)::int
       FROM journal_entries je
       WHERE je.entry_date BETWEEN $1::date AND $2::date
         AND je.status = 'posted') AS posted_entries,
      (SELECT COUNT(*)::int
       FROM journal_entries je
       WHERE je.entry_date BETWEEN $1::date AND $2::date
         AND je.status = 'draft') AS draft_entries,
      (SELECT COUNT(*)::int
       FROM journal_entries je
       WHERE je.entry_date BETWEEN $1::date AND $2::date
         AND je.status = 'cancelled') AS cancelled_entries,
      (SELECT COUNT(*)::int
       FROM (
         SELECT je.id
         FROM journal_entries je
         INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.entry_date BETWEEN $1::date AND $2::date
           AND je.status = 'posted'
         GROUP BY je.id
         HAVING ROUND(COALESCE(SUM(jel.debit), 0)::numeric, 2)
              <> ROUND(COALESCE(SUM(jel.credit), 0)::numeric, 2)
       ) AS imbalanced) AS imbalanced_entries;
  `;

  const horizonsQuery = `
    WITH customer_payment_totals AS (
      SELECT
        p.invoice_id,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM payments p
      GROUP BY p.invoice_id
    ),
    invoice_balances AS (
      SELECT
        i.id,
        i.due_date,
        GREATEST(
          COALESCE(i.total_amount, 0) - COALESCE(cpt.paid_to_cutoff, 0),
          0
        ) AS balance_due
      FROM invoices i
      LEFT JOIN customer_payment_totals cpt ON cpt.invoice_id = i.id
      WHERE COALESCE(i.status, 'issued') <> 'cancelled'
        AND i.invoice_date <= $1::date
    ),
    supplier_payment_totals AS (
      SELECT
        sp.purchase_invoice_id,
        COALESCE(SUM(sp.amount) FILTER (WHERE sp.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM supplier_payments sp
      GROUP BY sp.purchase_invoice_id
    ),
    purchase_balances AS (
      SELECT
        pi.id,
        pi.due_date,
        GREATEST(
          COALESCE(pi.total_amount, 0) - COALESCE(spt.paid_to_cutoff, 0),
          0
        ) AS balance_due
      FROM purchase_invoices pi
      LEFT JOIN supplier_payment_totals spt
        ON spt.purchase_invoice_id = pi.id
      WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
        AND pi.invoice_date <= $1::date
    ),
    actual_cash AS (
      SELECT
        (
          COALESCE((SELECT SUM(amount) FROM payments WHERE payment_date <= $1::date), 0)
          - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE payment_date <= $1::date), 0)
          - COALESCE((SELECT SUM(amount) FROM expenses WHERE expense_date <= $1::date), 0)
        ) AS cash_base
    ),
    horizons(days) AS (
      VALUES (7), (30), (60)
    )
    SELECT
      h.days AS horizon_days,
      (
        SELECT COUNT(*)::int
        FROM invoice_balances ib
        WHERE ib.balance_due > 0
          AND ib.due_date IS NOT NULL
          AND ib.due_date <= ($1::date + (h.days || ' days')::interval)
      ) AS due_receivables_count,
      (
        SELECT COALESCE(SUM(ib.balance_due), 0)
        FROM invoice_balances ib
        WHERE ib.balance_due > 0
          AND ib.due_date IS NOT NULL
          AND ib.due_date <= ($1::date + (h.days || ' days')::interval)
      ) AS expected_inflows,
      (
        SELECT COUNT(*)::int
        FROM purchase_balances pb
        WHERE pb.balance_due > 0
          AND pb.due_date IS NOT NULL
          AND pb.due_date <= ($1::date + (h.days || ' days')::interval)
      ) AS due_payables_count,
      (
        SELECT COALESCE(SUM(pb.balance_due), 0)
        FROM purchase_balances pb
        WHERE pb.balance_due > 0
          AND pb.due_date IS NOT NULL
          AND pb.due_date <= ($1::date + (h.days || ' days')::interval)
      ) AS expected_outflows,
      (
        ac.cash_base
        + (
          SELECT COALESCE(SUM(ib.balance_due), 0)
          FROM invoice_balances ib
          WHERE ib.balance_due > 0
            AND ib.due_date IS NOT NULL
            AND ib.due_date <= ($1::date + (h.days || ' days')::interval)
        )
        - (
          SELECT COALESCE(SUM(pb.balance_due), 0)
          FROM purchase_balances pb
          WHERE pb.balance_due > 0
            AND pb.due_date IS NOT NULL
            AND pb.due_date <= ($1::date + (h.days || ' days')::interval)
        )
      ) AS projected_balance
    FROM horizons h
    CROSS JOIN actual_cash ac
    ORDER BY h.days ASC;
  `;

  const receivablesDetailQuery = `
    WITH customer_payment_totals AS (
      SELECT
        p.invoice_id,
        COALESCE(SUM(p.amount) FILTER (WHERE p.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM payments p
      GROUP BY p.invoice_id
    )
    SELECT
      i.id AS invoice_id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      c.id AS customer_id,
      c.business_name AS customer_name,
      c.city AS customer_city,
      GREATEST(
        COALESCE(i.total_amount, 0) - COALESCE(cpt.paid_to_cutoff, 0),
        0
      ) AS balance_due,
      CASE
        WHEN i.due_date IS NULL THEN NULL
        ELSE (i.due_date - $1::date)
      END AS days_from_cutoff
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN customer_payment_totals cpt ON cpt.invoice_id = i.id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND i.invoice_date <= $1::date
      AND GREATEST(
        COALESCE(i.total_amount, 0) - COALESCE(cpt.paid_to_cutoff, 0),
        0
      ) > 0
      AND i.due_date IS NOT NULL
      AND i.due_date <= $2::date
    ORDER BY i.due_date ASC, balance_due DESC, i.id DESC
    LIMIT $3;
  `;

  const payablesDetailQuery = `
    WITH supplier_payment_totals AS (
      SELECT
        sp.purchase_invoice_id,
        COALESCE(SUM(sp.amount) FILTER (WHERE sp.payment_date <= $1::date), 0) AS paid_to_cutoff
      FROM supplier_payments sp
      GROUP BY sp.purchase_invoice_id
    )
    SELECT
      pi.id AS purchase_invoice_id,
      pi.purchase_invoice_number,
      pi.invoice_date,
      pi.due_date,
      s.id AS supplier_id,
      s.business_name AS supplier_name,
      s.city AS supplier_city,
      GREATEST(
        COALESCE(pi.total_amount, 0) - COALESCE(spt.paid_to_cutoff, 0),
        0
      ) AS balance_due,
      CASE
        WHEN pi.due_date IS NULL THEN NULL
        ELSE (pi.due_date - $1::date)
      END AS days_from_cutoff
    FROM purchase_invoices pi
    INNER JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN supplier_payment_totals spt
      ON spt.purchase_invoice_id = pi.id
    WHERE COALESCE(pi.status, 'issued') <> 'cancelled'
      AND pi.invoice_date <= $1::date
      AND GREATEST(
        COALESCE(pi.total_amount, 0) - COALESCE(spt.paid_to_cutoff, 0),
        0
      ) > 0
      AND pi.due_date IS NOT NULL
      AND pi.due_date <= $2::date
    ORDER BY pi.due_date ASC, balance_due DESC, pi.id DESC
    LIMIT $3;
  `;

  const topCustomersQuery = `
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
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND i.invoice_date BETWEEN $1::date AND $2::date
    GROUP BY c.id, c.business_name, c.city
    ORDER BY total_billed DESC, total_balance_due DESC, c.business_name ASC
    LIMIT $3;
  `;

  const topProductsQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.barcode,
      SUM(ii.quantity) AS total_quantity_sold,
      COALESCE(SUM(ii.line_total), 0) AS total_sales_value,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
      COALESCE(SUM(ii.line_total), 0)
        - COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS gross_profit_amount
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    INNER JOIN products p ON p.id = ii.product_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND i.invoice_date BETWEEN $1::date AND $2::date
    GROUP BY p.id, p.name, p.sku, p.barcode
    ORDER BY total_sales_value DESC, total_quantity_sold DESC, p.name ASC
    LIMIT $3;
  `;

  const [
    summaryResult,
    accountingSnapshotResult,
    horizonsResult,
    receivablesResult,
    payablesResult,
    topCustomersResult,
    topProductsResult,
    stockAlerts,
    lowRotationProducts,
    incomeStatement,
    balanceSheet,
    trialBalance,
    accountingHealth
  ] = await Promise.all([
    pool.query(summaryQuery, [period.end_date, period.start_date]),
    pool.query(accountingSnapshotQuery, [period.start_date, period.end_date]),
    pool.query(horizonsQuery, [period.end_date]),
    pool.query(receivablesDetailQuery, [
      period.end_date,
      horizon60Date,
      safeDetailLimit
    ]),
    pool.query(payablesDetailQuery, [period.end_date, horizon60Date, safeDetailLimit]),
    pool.query(topCustomersQuery, [
      period.start_date,
      period.end_date,
      safeDetailLimit
    ]),
    pool.query(topProductsQuery, [
      period.start_date,
      period.end_date,
      safeDetailLimit
    ]),
    getStockAlerts(),
    getLowRotationProducts(safeDetailLimit),
    getIncomeStatement({
      start_date: period.start_date,
      end_date: period.end_date,
      status: "posted"
    }),
    getBalanceSheet({
      end_date: period.end_date,
      status: "posted"
    }),
    getTrialBalance({
      start_date: period.start_date,
      end_date: period.end_date,
      status: "posted"
    }),
    getAccountingHealthSnapshot()
  ]);

  const summaryRow = summaryResult.rows[0] || {};
  const accountingSnapshotRow = accountingSnapshotResult.rows[0] || {};

  const executiveSummary = {
    period_invoices_count: Number(summaryRow.period_invoices_count || 0),
    period_sales_amount: roundAmount(summaryRow.period_sales_amount),
    period_net_sales_amount: roundAmount(summaryRow.period_net_sales_amount),
    period_cogs_amount: roundAmount(summaryRow.period_cogs_amount),
    period_gross_profit_amount: roundAmount(summaryRow.period_gross_profit_amount),
    period_purchase_invoices_count: Number(
      summaryRow.period_purchase_invoices_count || 0
    ),
    period_purchases_amount: roundAmount(summaryRow.period_purchases_amount),
    period_customer_payments_count: Number(
      summaryRow.period_customer_payments_count || 0
    ),
    period_collections_amount: roundAmount(summaryRow.period_collections_amount),
    period_supplier_payments_count: Number(
      summaryRow.period_supplier_payments_count || 0
    ),
    period_supplier_payments_amount: roundAmount(
      summaryRow.period_supplier_payments_amount
    ),
    period_expenses_count: Number(summaryRow.period_expenses_count || 0),
    period_expenses_amount: roundAmount(summaryRow.period_expenses_amount),
    open_receivables_count: Number(summaryRow.open_receivables_count || 0),
    receivables_at_close: roundAmount(summaryRow.receivables_at_close),
    overdue_receivables_at_close: roundAmount(
      summaryRow.overdue_receivables_at_close
    ),
    open_payables_count: Number(summaryRow.open_payables_count || 0),
    payables_at_close: roundAmount(summaryRow.payables_at_close),
    overdue_payables_at_close: roundAmount(summaryRow.overdue_payables_at_close),
    cash_base_at_close: roundAmount(summaryRow.cash_base_at_close),
    current_stock_alerts_count: Number(
      summaryRow.current_stock_alerts_count || 0
    ),
    current_stock_value: roundAmount(summaryRow.current_stock_value),
    accounting_net_result: roundAmount(incomeStatement?.totals?.net_result),
    projected_cash_30d: 0
  };

  const horizons = horizonsResult.rows.map((row) => ({
    horizon_days: Number(row.horizon_days || 0),
    due_receivables_count: Number(row.due_receivables_count || 0),
    expected_inflows: roundAmount(row.expected_inflows),
    due_payables_count: Number(row.due_payables_count || 0),
    expected_outflows: roundAmount(row.expected_outflows),
    projected_balance: roundAmount(row.projected_balance)
  }));

  executiveSummary.projected_cash_30d = roundAmount(
    horizons.find((row) => row.horizon_days === 30)?.projected_balance || 0
  );

  const accountingSnapshot = {
    invoices_to_fix: Number(accountingSnapshotRow.invoices_to_fix || 0),
    payments_to_fix: Number(accountingSnapshotRow.payments_to_fix || 0),
    expenses_to_fix: Number(accountingSnapshotRow.expenses_to_fix || 0),
    purchase_invoices_to_fix: Number(
      accountingSnapshotRow.purchase_invoices_to_fix || 0
    ),
    supplier_payments_to_fix: Number(
      accountingSnapshotRow.supplier_payments_to_fix || 0
    ),
    total_entries: Number(accountingSnapshotRow.total_entries || 0),
    posted_entries: Number(accountingSnapshotRow.posted_entries || 0),
    draft_entries: Number(accountingSnapshotRow.draft_entries || 0),
    cancelled_entries: Number(accountingSnapshotRow.cancelled_entries || 0),
    imbalanced_entries: Number(accountingSnapshotRow.imbalanced_entries || 0)
  };

  const checklist = buildCloseChecklist(executiveSummary, accountingSnapshot);

  const receivablesDue = receivablesResult.rows.map((row) => ({
    ...row,
    balance_due: roundAmount(row.balance_due),
    days_from_cutoff:
      row.days_from_cutoff === null ? null : Number(row.days_from_cutoff)
  }));

  const payablesDue = payablesResult.rows.map((row) => ({
    ...row,
    balance_due: roundAmount(row.balance_due),
    days_from_cutoff:
      row.days_from_cutoff === null ? null : Number(row.days_from_cutoff)
  }));

  const topCustomers = topCustomersResult.rows.map((row) => ({
    ...row,
    total_invoices: Number(row.total_invoices || 0),
    total_billed: roundAmount(row.total_billed),
    total_paid: roundAmount(row.total_paid),
    total_balance_due: roundAmount(row.total_balance_due)
  }));

  const topProducts = topProductsResult.rows.map((row) => ({
    ...row,
    total_quantity_sold: roundAmount(row.total_quantity_sold),
    total_sales_value: roundAmount(row.total_sales_value),
    total_cogs_amount: roundAmount(row.total_cogs_amount),
    gross_profit_amount: roundAmount(row.gross_profit_amount)
  }));

  const topRevenueAccounts = [...(incomeStatement?.revenues || [])]
    .sort((left, right) => Number(right.net_amount || 0) - Number(left.net_amount || 0))
    .slice(0, safeDetailLimit);
  const topExpenseAccounts = [...(incomeStatement?.expenses || [])]
    .sort((left, right) => Number(right.net_amount || 0) - Number(left.net_amount || 0))
    .slice(0, safeDetailLimit);

  return {
    period: {
      year: Number(year),
      month: Number(month),
      label: period.period_label,
      start_date: period.start_date,
      end_date: period.end_date,
      generated_at: new Date().toISOString(),
      detail_limit: safeDetailLimit,
      scope_note:
        "Le pack consolide la direction et la compta a l'echelle de l'entreprise. Les alertes stock sont presentees a la date de generation du pack."
    },
    executive_summary: executiveSummary,
    accounting_snapshot: accountingSnapshot,
    close_checklist: checklist,
    cash_projection: {
      cutoff_date: period.end_date,
      horizons,
      receivables_due: receivablesDue,
      payables_due: payablesDue
    },
    accounting_health: accountingHealth,
    income_statement: {
      totals: {
        total_revenue: roundAmount(incomeStatement?.totals?.total_revenue),
        total_expense: roundAmount(incomeStatement?.totals?.total_expense),
        net_result: roundAmount(incomeStatement?.totals?.net_result)
      },
      top_revenue_accounts: topRevenueAccounts.map((row) => ({
        ...row,
        net_amount: roundAmount(row.net_amount)
      })),
      top_expense_accounts: topExpenseAccounts.map((row) => ({
        ...row,
        net_amount: roundAmount(row.net_amount)
      }))
    },
    balance_sheet: {
      totals: {
        total_assets: roundAmount(balanceSheet?.totals?.total_assets),
        total_liabilities: roundAmount(balanceSheet?.totals?.total_liabilities),
        total_equity: roundAmount(balanceSheet?.totals?.total_equity),
        total_liabilities_and_equity: roundAmount(
          balanceSheet?.totals?.total_liabilities_and_equity
        ),
        gap: roundAmount(balanceSheet?.totals?.gap)
      }
    },
    trial_balance: {
      totals: {
        total_debit: roundAmount(trialBalance?.totals?.total_debit),
        total_credit: roundAmount(trialBalance?.totals?.total_credit),
        total_debit_balance: roundAmount(
          trialBalance?.totals?.total_debit_balance
        ),
        total_credit_balance: roundAmount(
          trialBalance?.totals?.total_credit_balance
        )
      }
    },
    top_customers: topCustomers,
    top_products: topProducts,
    stock_alerts: (stockAlerts || []).slice(0, safeDetailLimit),
    low_rotation_products: (lowRotationProducts || []).slice(0, safeDetailLimit)
  };
}
