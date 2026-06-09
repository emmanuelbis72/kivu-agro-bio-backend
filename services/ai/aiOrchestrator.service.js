import {
  getGlobalStats,
  getStockAlerts,
  getTopProducts,
  getTopCustomers,
  getRecentInvoices,
  getAccountingGlobalStats,
  getRecentJournalEntries,
  getAccountingMonthlyOverview,
  getAccountClassBalances,
  getRecentPayments,
  getCashForecast,
  getCommercialDashboard,
  getAccountingHealthSnapshot,
  getLowRotationProducts
} from "../../models/dashboard.model.js";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance
} from "../../models/accountingReport.model.js";
import { getMonthlyClosePack } from "../../models/monthlyClose.model.js";
import { getAllBudgets, getBudgetVsActual } from "../../models/budget.model.js";
import { getAllPurchaseInvoices } from "../../models/purchaseInvoice.model.js";
import { getAllPurchaseOrders } from "../../models/purchaseOrder.model.js";
import { getProductionBatches } from "../../models/production.model.js";
import { getAllExpenses } from "../../models/expense.model.js";
import { getAllInvoices } from "../../models/invoice.model.js";
import { detectIntent } from "./naturalQuery.service.js";
import { composeAIResponse } from "./responseComposer.service.js";
import {
  getBusinessRulesMap,
  isStrategicProduct,
  isPriorityChannel,
  isPriorityCity
} from "./businessRules.service.js";
import { runDeepseekReasoning } from "./deepseekReasoner.service.js";
import { getActiveCompanyKnowledge } from "./companyKnowledge.service.js";

const aiHistory = [];

const quickQuestions = [
  "Pourquoi les ventes ont baissé cette semaine ?",
  "Quels produits dois-je réapprovisionner en priorité ?",
  "Quels sont mes clients les plus risqués ?",
  "Quelles dépenses pèsent le plus ce mois ?",
  "Quelle est ma situation de trésorerie ?",
  "Résume-moi la situation comptable actuelle.",
  "Donne-moi un brief CEO global de KIVU AGRO BIO.",
  "Quels sont les risques les plus urgents pour KIVU AGRO BIO ?",
  "Quelles opportunités dois-je exploiter ce mois ?"
];

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getEnvNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function average(values = []) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length
  );
}

async function safeExecute(task, fallback) {
  try {
    return await task();
  } catch (error) {
    console.warn("[AI] Optional context skipped:", error.message);
    return fallback;
  }
}

function getPreviousClosedMonth() {
  const now = new Date();
  const previousMonthDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );

  return {
    year: previousMonthDate.getUTCFullYear(),
    month: previousMonthDate.getUTCMonth() + 1
  };
}

async function getPrimaryBudgetComparison() {
  const budgets = await getAllBudgets();
  const currentYear = new Date().getUTCFullYear();
  const primaryBudget =
    budgets.find(
      (budget) => budget.is_active && Number(budget.fiscal_year) === currentYear
    ) ||
    budgets.find((budget) => budget.is_active) ||
    budgets[0] ||
    null;

  if (!primaryBudget) {
    return null;
  }

  return getBudgetVsActual(primaryBudget.id);
}

function toIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function withTimeout(task, timeoutMs, label) {
  return Promise.race([
    task,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs}ms`);
        error.code = "TIMEOUT";
        reject(error);
      }, timeoutMs);
    })
  ]);
}

function truncateText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function sanitizeMetrics(metrics = {}) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metrics)
      .filter(([, value]) =>
        ["number", "string", "boolean"].includes(typeof value)
      )
      .slice(0, 12)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? truncateText(value, 120) : value
      ])
  );
}

function sanitizeReasoningResponse(reasoning = {}, period = "global") {
  const risks = Array.isArray(reasoning.risks) ? reasoning.risks : [];
  const opportunities = Array.isArray(reasoning.opportunities)
    ? reasoning.opportunities
    : [];
  const actions = Array.isArray(reasoning.actions) ? reasoning.actions : [];
  const recommendations =
    actions.length > 0
      ? actions
      : Array.isArray(reasoning.recommendations)
      ? reasoning.recommendations
      : [];

  return {
    intent: "ai_reasoning",
    period,
    source_module: "ai_assistant",
    summary: truncateText(reasoning.summary, 900),
    answer: truncateText(reasoning.analysis, 5000),
    metrics: sanitizeMetrics(reasoning.metrics),
    drivers: [
      ...risks.slice(0, 5).map((item) => `Risque: ${truncateText(item, 240)}`),
      ...opportunities
        .slice(0, 5)
        .map((item) => `Opportunité: ${truncateText(item, 240)}`)
    ],
    recommendations: recommendations
      .slice(0, 6)
      .map((item) => truncateText(item, 240))
      .filter(Boolean),
    priority_level: reasoning.priority_level || "MEDIUM",
    confidence_score: reasoning.confidence_score || 0.95,
    generated_at: new Date().toISOString()
  };
}

function getReasoningDateRange(period = "current") {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  let start = new Date(end);

  switch (period) {
    case "today":
      break;
    case "this_week": {
      const day = start.getUTCDay();
      const offset = day === 0 ? 6 : day - 1;
      start.setUTCDate(start.getUTCDate() - offset);
      break;
    }
    case "this_month":
    case "current":
    default:
      start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
      break;
  }

  return {
    label: period,
    start_date: toIsoDate(start),
    end_date: toIsoDate(end)
  };
}

function compactCompanyKnowledge(rows = []) {
  return rows.map((row) => ({
    title: row.title,
    category: row.category,
    content: String(row.content || "").trim().slice(0, 280),
    priority_level: row.priority_level
  }));
}

function compactBusinessRulesForReasoning(businessRules = {}) {
  return {
    strategic_products: Array.isArray(businessRules.strategic_products)
      ? businessRules.strategic_products.slice(0, 8)
      : [],
    priority_cities: Array.isArray(businessRules.priority_cities)
      ? businessRules.priority_cities.slice(0, 6)
      : [],
    priority_channels: Array.isArray(businessRules.priority_channels)
      ? businessRules.priority_channels.slice(0, 8)
      : [],
    minimum_cash_threshold_usd: Number(
      businessRules.minimum_cash_threshold_usd || 3000
    ),
    target_net_margin_range: businessRules.target_net_margin_range || {
      min: 25,
      max: 30
    },
    monthly_revenue_targets: businessRules.monthly_revenue_targets || {}
  };
}

function getReasoningFocus(intent) {
  switch (intent) {
    case "sales_overview":
    case "sales_variance_explanation":
      return "sales";
    case "stock_priority_restock":
      return "stock";
    case "customer_receivables_risk":
      return "customers";
    case "expense_pressure_analysis":
      return "expenses";
    case "procurement_overview":
      return "procurement";
    case "production_performance":
      return "production";
    case "budget_vs_actual_analysis":
      return "budget";
    case "forecast_projection":
      return "forecast";
    case "cash_position_analysis":
      return "cash";
    case "accounting_summary":
      return "accounting";
    default:
      return "general";
  }
}

function summarizeGlobalStats(globalStats = {}) {
  return {
    total_sales_amount: round2(globalStats.total_sales_amount),
    total_net_sales_amount: round2(globalStats.total_net_sales_amount),
    total_collected_amount: round2(globalStats.total_collected_amount),
    total_receivables: round2(globalStats.total_receivables),
    gross_profit_amount: round2(globalStats.gross_profit_amount),
    gross_margin_percent: round2(globalStats.gross_margin_percent),
    total_units_in_stock: Number(globalStats.total_units_in_stock || 0),
    total_customers: Number(globalStats.total_customers || 0),
    total_invoices: Number(globalStats.total_invoices || 0)
  };
}

function summarizeAccountingStats(accounting = {}) {
  const totalPostedDebit = round2(accounting.total_posted_debit);
  const totalPostedCredit = round2(accounting.total_posted_credit);

  return {
    total_accounts: Number(accounting.total_accounts || 0),
    total_entries: Number(accounting.total_entries || 0),
    posted_entries: Number(accounting.posted_entries || 0),
    draft_entries: Number(accounting.draft_entries || 0),
    total_posted_debit: totalPostedDebit,
    total_posted_credit: totalPostedCredit,
    posted_balance_gap: round2(totalPostedDebit - totalPostedCredit)
  };
}

function compactMonthlyAccountingOverview(rows = [], limit = 4) {
  return rows.slice(-limit).map((row) => ({
    period: row.period,
    total_entries: Number(row.total_entries || 0),
    total_debit: round2(row.total_debit),
    total_credit: round2(row.total_credit),
    balance_gap: round2(Number(row.total_debit || 0) - Number(row.total_credit || 0))
  }));
}

function compactAccountClassBalances(rows = [], limit = 6) {
  return rows.slice(0, limit).map((row) => ({
    account_class: row.account_class,
    total_debit: round2(row.total_debit),
    total_credit: round2(row.total_credit),
    balance: round2(row.balance)
  }));
}

function compactIncomeStatement(report = {}) {
  const revenues = Array.isArray(report.revenues) ? report.revenues : [];
  const expenses = Array.isArray(report.expenses) ? report.expenses : [];
  const totals = report.totals || {};

  return {
    totals: {
      total_revenue: round2(totals.total_revenue),
      total_expense: round2(totals.total_expense),
      net_result: round2(totals.net_result)
    },
    top_revenues: revenues.slice(0, 5).map((row) => ({
      account_number: row.account_number,
      account_name: row.account_name,
      net_amount: round2(row.net_amount)
    })),
    top_expenses: expenses
      .slice()
      .sort((a, b) => Number(b.net_amount || 0) - Number(a.net_amount || 0))
      .slice(0, 5)
      .map((row) => ({
        account_number: row.account_number,
        account_name: row.account_name,
        net_amount: round2(row.net_amount)
      }))
  };
}

function compactBalanceSheet(report = {}) {
  const assets = Array.isArray(report.assets) ? report.assets : [];
  const liabilities = Array.isArray(report.liabilities) ? report.liabilities : [];
  const equity = Array.isArray(report.equity) ? report.equity : [];
  const totals = report.totals || {};

  return {
    totals: {
      total_assets: round2(totals.total_assets),
      total_liabilities: round2(totals.total_liabilities),
      total_equity: round2(totals.total_equity),
      total_liabilities_and_equity: round2(totals.total_liabilities_and_equity),
      gap: round2(totals.gap)
    },
    top_assets: assets
      .slice()
      .sort((a, b) => Number(b.balance_amount || 0) - Number(a.balance_amount || 0))
      .slice(0, 5)
      .map((row) => ({
        account_number: row.account_number,
        account_name: row.account_name,
        balance_amount: round2(row.balance_amount)
      })),
    top_liabilities: liabilities
      .slice()
      .sort((a, b) => Number(b.balance_amount || 0) - Number(a.balance_amount || 0))
      .slice(0, 5)
      .map((row) => ({
        account_number: row.account_number,
        account_name: row.account_name,
        balance_amount: round2(row.balance_amount)
      })),
    top_equity: equity
      .slice()
      .sort((a, b) => Number(b.balance_amount || 0) - Number(a.balance_amount || 0))
      .slice(0, 5)
      .map((row) => ({
        account_number: row.account_number,
        account_name: row.account_name,
        balance_amount: round2(row.balance_amount)
      }))
  };
}

function compactTrialBalance(report = {}) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const totals = report.totals || {};

  return {
    totals: {
      total_debit: round2(totals.total_debit),
      total_credit: round2(totals.total_credit),
      total_debit_balance: round2(totals.total_debit_balance),
      total_credit_balance: round2(totals.total_credit_balance),
      trial_gap: round2(
        Number(totals.total_debit || 0) - Number(totals.total_credit || 0)
      )
    },
    top_accounts: rows
      .slice()
      .sort(
        (a, b) =>
          Math.abs(Number(b.balance || 0)) - Math.abs(Number(a.balance || 0))
      )
      .slice(0, 5)
      .map((row) => ({
        account_number: row.account_number,
        account_name: row.account_name,
        account_type: row.account_type,
        balance: round2(row.balance),
        total_debit: round2(row.total_debit),
        total_credit: round2(row.total_credit)
      }))
  };
}

function summarizeCashForecast(forecast = {}) {
  const safeForecast = forecast || {};
  const horizons = Array.isArray(safeForecast.horizons)
    ? safeForecast.horizons
    : [];

  return {
    summary: safeForecast.summary || {},
    horizons: horizons.map((row) => ({
      horizon_days: Number(row.horizon_days || 0),
      expected_inflows: round2(row.expected_inflows),
      expected_outflows: round2(row.expected_outflows),
      projected_balance: round2(row.projected_balance)
    })),
    receivables_due_soon: (safeForecast.receivables_due_soon || [])
      .slice(0, 5)
      .map((row) => ({
        customer_name: row.customer_name,
        invoice_number: row.invoice_number,
        due_date: row.due_date,
        balance_due: round2(row.balance_due),
        days_from_today: Number(row.days_from_today || 0)
      })),
    payables_due_soon: (safeForecast.payables_due_soon || [])
      .slice(0, 5)
      .map((row) => ({
        supplier_name: row.supplier_name,
        purchase_invoice_number: row.purchase_invoice_number,
        due_date: row.due_date,
        balance_due: round2(row.balance_due),
        days_from_today: Number(row.days_from_today || 0)
      }))
  };
}

function summarizeCommercialDashboard(dashboard = {}) {
  const safeDashboard = dashboard || {};
  const summary = safeDashboard.summary || {};

  return {
    summary: {
      total_sales_amount: round2(summary.total_sales_amount),
      total_net_sales_amount: round2(summary.total_net_sales_amount),
      total_collected_amount: round2(summary.total_collected_amount),
      total_receivables: round2(summary.total_receivables),
      gross_profit_amount: round2(summary.gross_profit_amount),
      gross_margin_percent: round2(summary.gross_margin_percent),
      total_invoices: Number(summary.total_invoices || 0),
      active_customers: Number(summary.active_customers || 0),
      active_warehouses: Number(summary.active_warehouses || 0),
      active_cities: Number(summary.active_cities || 0)
    },
    monthly_trend: (safeDashboard.monthly_trend || []).slice(-4).map((row) => ({
      period: row.period,
      total_sales_amount: round2(row.total_sales_amount),
      total_collected_amount: round2(row.total_collected_amount),
      total_receivables: round2(row.total_receivables),
      gross_profit_amount: round2(row.gross_profit_amount)
    })),
    sales_by_city: (safeDashboard.sales_by_city || []).slice(0, 4).map((row) => ({
      city: row.city,
      total_sales_amount: round2(row.total_sales_amount),
      total_receivables: round2(row.total_receivables),
      gross_profit_amount: round2(row.gross_profit_amount)
    })),
    sales_by_warehouse: (safeDashboard.sales_by_warehouse || [])
      .slice(0, 4)
      .map((row) => ({
        warehouse_name: row.warehouse_name,
        warehouse_city: row.warehouse_city,
        total_sales_amount: round2(row.total_sales_amount),
        total_receivables: round2(row.total_receivables),
        gross_profit_amount: round2(row.gross_profit_amount)
      })),
    sales_by_customer: (safeDashboard.sales_by_customer || [])
      .slice(0, 5)
      .map((row) => ({
        business_name: row.business_name,
        city: row.city || null,
        total_sales_amount: round2(row.total_sales_amount),
        total_collected_amount: round2(row.total_collected_amount),
        total_receivables: round2(row.total_receivables),
        gross_profit_amount: round2(row.gross_profit_amount),
        last_invoice_date: row.last_invoice_date
      })),
    sales_by_product: (safeDashboard.sales_by_product || [])
      .slice(0, 5)
      .map((row) => ({
        product_name: row.product_name,
        category: row.category || null,
        total_quantity_sold: round2(row.total_quantity_sold),
        total_sales_amount: round2(row.total_sales_amount),
        gross_profit_amount: round2(row.gross_profit_amount),
        gross_margin_percent: round2(row.gross_margin_percent)
      })),
    declining_products: (safeDashboard.declining_products || [])
      .slice(0, 4)
      .map((row) => ({
        product_name: row.product_name,
        previous_sales_amount: round2(row.previous_sales_amount),
        current_sales_amount: round2(row.current_sales_amount),
        sales_change_percent:
          row.sales_change_percent === null
            ? null
            : round2(row.sales_change_percent)
      })),
    dormant_clients: (safeDashboard.dormant_clients || []).slice(0, 4).map((row) => ({
      business_name: row.business_name,
      city: row.city || null,
      total_sales_amount: round2(row.total_sales_amount),
      days_since_last_invoice: Number(row.days_since_last_invoice || 0)
    })),
    reactivation_candidates: (safeDashboard.reactivation_candidates || [])
      .slice(0, 4)
      .map((row) => ({
        business_name: row.business_name,
        city: row.city || null,
        total_sales_amount: round2(row.total_sales_amount),
        days_since_last_invoice: Number(row.days_since_last_invoice || 0)
      }))
  };
}

function summarizeAccountingHealth(health = {}) {
  const safeHealth = health || {};

  return {
    status: safeHealth.status || "attention",
    issues: (safeHealth.issues || []).slice(0, 6),
    totals: {
      payments_to_fix: Number(safeHealth?.totals?.payments_to_fix || 0),
      supplier_payments_to_fix: Number(
        safeHealth?.totals?.supplier_payments_to_fix || 0
      ),
      invoices_to_fix: Number(safeHealth?.totals?.invoices_to_fix || 0),
      purchase_invoices_to_fix: Number(
        safeHealth?.totals?.purchase_invoices_to_fix || 0
      ),
      expenses_to_fix: Number(safeHealth?.totals?.expenses_to_fix || 0),
      draft_entries: Number(safeHealth?.totals?.draft_entries || 0),
      imbalanced_entries: Number(safeHealth?.totals?.imbalanced_entries || 0),
      orphan_links: Number(safeHealth?.totals?.orphan_links || 0),
      total_entries: Number(safeHealth?.totals?.total_entries || 0),
      posted_entries: Number(safeHealth?.totals?.posted_entries || 0)
    },
    coverage: {
      payment_method_mappings_count: Number(
        safeHealth?.coverage?.payment_method_mappings_count || 0
      ),
      missing_payment_methods: (
        safeHealth?.coverage?.missing_payment_methods || []
      ).slice(0, 6),
      configured_expense_categories: Number(
        safeHealth?.coverage?.configured_expense_categories || 0
      ),
      unmapped_expense_categories: (
        safeHealth?.coverage?.unmapped_expense_categories || []
      ).slice(0, 6)
    }
  };
}

function summarizePurchaseInvoices(invoices = []) {
  const rows = Array.isArray(invoices) ? invoices : [];
  const openRows = rows.filter(
    (row) =>
      ["issued", "partial"].includes(String(row.status || "").toLowerCase()) &&
      Number(row.balance_due || 0) > 0
  );
  const totalPurchased = rows.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );
  const totalPaid = rows.reduce((sum, row) => sum + Number(row.paid_amount || 0), 0);
  const totalBalanceDue = openRows.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );
  const topSuppliers = new Map();

  rows.forEach((row) => {
    const key = String(row.supplier_name || "Sans fournisseur");
    const current = topSuppliers.get(key) || {
      supplier_name: key,
      total_amount: 0,
      balance_due: 0
    };

    current.total_amount += Number(row.total_amount || 0);
    current.balance_due += Number(row.balance_due || 0);
    topSuppliers.set(key, current);
  });

  return {
    summary: {
      total_invoices: rows.length,
      open_invoices: openRows.length,
      total_purchased: round2(totalPurchased),
      total_paid: round2(totalPaid),
      total_balance_due: round2(totalBalanceDue)
    },
    top_suppliers: Array.from(topSuppliers.values())
      .sort((left, right) => right.total_amount - left.total_amount)
      .slice(0, 5)
      .map((row) => ({
        supplier_name: row.supplier_name,
        total_amount: round2(row.total_amount),
        balance_due: round2(row.balance_due)
      })),
    recent_invoices: rows.slice(0, 5).map((row) => ({
      purchase_invoice_number: row.purchase_invoice_number,
      supplier_name: row.supplier_name,
      invoice_date: row.invoice_date,
      due_date: row.due_date,
      status: row.status,
      total_amount: round2(row.total_amount),
      balance_due: round2(row.balance_due)
    }))
  };
}

function summarizePurchaseOrders(orders = []) {
  const rows = Array.isArray(orders) ? orders : [];
  const openStatuses = new Set(["draft", "ordered", "partially_received"]);
  const openRows = rows.filter((row) =>
    openStatuses.has(String(row.status || "").toLowerCase())
  );

  return {
    summary: {
      total_orders: rows.length,
      open_orders: openRows.length,
      total_ordered_amount: round2(
        rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
      )
    },
    recent_orders: rows.slice(0, 5).map((row) => ({
      purchase_order_number: row.purchase_order_number,
      supplier_name: row.supplier_name,
      warehouse_name: row.warehouse_name,
      order_date: row.order_date,
      expected_date: row.expected_date,
      status: row.status,
      total_amount: round2(row.total_amount),
      total_ordered_quantity: round2(row.total_ordered_quantity),
      total_received_quantity: round2(row.total_received_quantity)
    }))
  };
}

function summarizeProductionBatches(batches = []) {
  const rows = Array.isArray(batches) ? batches : [];
  const productTotals = new Map();

  rows.forEach((row) => {
    const key = String(row.finished_product_name || "Produit fini");
    const current = productTotals.get(key) || {
      finished_product_name: key,
      total_quantity_produced: 0
    };

    current.total_quantity_produced += Number(row.quantity_produced || 0);
    productTotals.set(key, current);
  });

  return {
    summary: {
      total_batches: rows.length,
      total_quantity_produced: round2(
        rows.reduce((sum, row) => sum + Number(row.quantity_produced || 0), 0)
      )
    },
    top_finished_products: Array.from(productTotals.values())
      .sort(
        (left, right) =>
          right.total_quantity_produced - left.total_quantity_produced
      )
      .slice(0, 5)
      .map((row) => ({
        finished_product_name: row.finished_product_name,
        total_quantity_produced: round2(row.total_quantity_produced)
      })),
    recent_batches: rows.slice(0, 5).map((row) => ({
      batch_number: row.batch_number,
      production_date: row.production_date,
      warehouse_name: row.warehouse_name,
      finished_product_name: row.finished_product_name,
      quantity_produced: round2(row.quantity_produced),
      status: row.status
    }))
  };
}

function summarizeBudgetComparison(comparison) {
  if (!comparison) {
    return null;
  }

  const rows = Array.isArray(comparison.rows) ? comparison.rows : [];
  const monthRows = Array.isArray(comparison.month_rows)
    ? comparison.month_rows
    : [];

  return {
    budget: {
      id: comparison?.budget?.id,
      name: comparison?.budget?.name,
      fiscal_year: Number(comparison?.budget?.fiscal_year || 0),
      warehouse_name: comparison?.budget?.warehouse_name || null
    },
    summary: {
      total_planned: round2(comparison?.summary?.total_planned),
      total_actual: round2(comparison?.summary?.total_actual),
      total_variance: round2(comparison?.summary?.total_variance),
      attainment_percent: round2(comparison?.summary?.attainment_percent)
    },
    top_category_variances: rows
      .slice()
      .sort(
        (left, right) =>
          Math.abs(Number(right.variance_total || 0)) -
          Math.abs(Number(left.variance_total || 0))
      )
      .slice(0, 5)
      .map((row) => ({
        category_label: row.category_label,
        category_type: row.category_type,
        planned_total: round2(row.planned_total),
        actual_total: round2(row.actual_total),
        variance_total: round2(row.variance_total),
        attainment_percent: round2(row.attainment_percent)
      })),
    top_month_variances: monthRows
      .slice()
      .sort(
        (left, right) =>
          Math.abs(Number(right.variance_total || 0)) -
          Math.abs(Number(left.variance_total || 0))
      )
      .slice(0, 4)
      .map((row) => ({
        month_number: Number(row.month_number || 0),
        month_label: row.month_label,
        planned_total: round2(row.planned_total),
        actual_total: round2(row.actual_total),
        variance_total: round2(row.variance_total)
      }))
  };
}

function summarizeMonthlyClosePack(pack) {
  if (!pack) {
    return null;
  }

  return {
    period: pack.period,
    executive_summary: pack.executive_summary || {},
    accounting_snapshot: pack.accounting_snapshot || {},
    close_checklist: {
      close_status: pack?.close_checklist?.close_status || "attention",
      critical_count: Number(pack?.close_checklist?.critical_count || 0),
      attention_count: Number(pack?.close_checklist?.attention_count || 0),
      key_items: (pack?.close_checklist?.items || [])
        .filter((item) => item.status !== "done")
        .slice(0, 5)
        .map((item) => ({
          label: item.label,
          status: item.status,
          detail: item.detail
        }))
    },
    cash_projection: {
      horizons: (pack?.cash_projection?.horizons || []).slice(0, 3),
      receivables_due: (pack?.cash_projection?.receivables_due || [])
        .slice(0, 4)
        .map((row) => ({
          customer_name: row.customer_name,
          invoice_number: row.invoice_number,
          balance_due: round2(row.balance_due),
          days_from_cutoff: row.days_from_cutoff
        })),
      payables_due: (pack?.cash_projection?.payables_due || [])
        .slice(0, 4)
        .map((row) => ({
          supplier_name: row.supplier_name,
          purchase_invoice_number: row.purchase_invoice_number,
          balance_due: round2(row.balance_due),
          days_from_cutoff: row.days_from_cutoff
        }))
    }
  };
}

function buildPredictiveSignals({
  businessRules = {},
  commercialDashboard,
  cashForecast,
  stockAlerts = [],
  lowRotationProducts = [],
  budgetComparison,
  purchaseInvoiceSummary,
  productionSummary
}) {
  const commercialTrend = commercialDashboard?.monthly_trend || [];
  const recentTrend = commercialTrend.slice(-3);
  const averageMonthlySales = round2(
    average(recentTrend.map((row) => row.total_sales_amount))
  );
  const averageMonthlyCollections = round2(
    average(recentTrend.map((row) => row.total_collected_amount))
  );
  const averageMonthlyMargin = round2(
    average(
      recentTrend.map((row) => {
        const netSales = Number(row.total_sales_amount || 0);
        if (netSales <= 0) return 0;
        return (Number(row.gross_profit_amount || 0) / netSales) * 100;
      })
    )
  );
  const j7 = (cashForecast?.horizons || []).find(
    (row) => Number(row.horizon_days || 0) === 7
  );
  const j30 = (cashForecast?.horizons || []).find(
    (row) => Number(row.horizon_days || 0) === 30
  );
  const j60 = (cashForecast?.horizons || []).find(
    (row) => Number(row.horizon_days || 0) === 60
  );
  const minimumCashThreshold = Number(
    businessRules.minimum_cash_threshold_usd || 3000
  );
  const signals = [];

  if (j30 && Number(j30.projected_balance || 0) < minimumCashThreshold) {
    signals.push(
      `Projection J+30 sous le seuil de cash: ${round2(
        j30.projected_balance
      )} USD pour un minimum cible de ${round2(minimumCashThreshold)} USD.`
    );
  }

  if ((commercialDashboard?.declining_products || []).length > 0) {
    const leadDecline = commercialDashboard.declining_products[0];
    signals.push(
      `Produit en baisse a surveiller: ${leadDecline.product_name} (${round2(
        leadDecline.sales_change_percent
      )}% sur 30 jours).`
    );
  }

  if (Number(stockAlerts.length || 0) > 0) {
    signals.push(
      `${stockAlerts.length} alerte(s) stock peuvent freiner les ventes projetees.`
    );
  }

  if (Number(lowRotationProducts.length || 0) > 0) {
    signals.push(
      `${lowRotationProducts.length} produit(s) a faible rotation immobilisent potentiellement du cash.`
    );
  }

  if (
    Number(budgetComparison?.summary?.total_variance || 0) > 0 &&
    round2(budgetComparison.summary.total_variance) > 0
  ) {
    signals.push(
      `Le realise depasse le budget de ${round2(
        budgetComparison.summary.total_variance
      )} USD sur le perimetre budgetaire actif.`
    );
  }

  if (
    Number(purchaseInvoiceSummary?.summary?.total_balance_due || 0) >
    Number(cashForecast?.summary?.open_payables || 0)
  ) {
    signals.push(
      "Les dettes fournisseurs ouvertes depassent la capacite de cash visible a court terme."
    );
  }

  if (Number(productionSummary?.summary?.total_batches || 0) === 0) {
    signals.push("Aucune production recente visible pour soutenir la croissance.");
  }

  return {
    sales_run_rate_30d_usd: averageMonthlySales,
    collections_run_rate_30d_usd: averageMonthlyCollections,
    average_gross_margin_percent: averageMonthlyMargin,
    projected_cash_balance_j7: round2(j7?.projected_balance),
    projected_cash_balance_j30: round2(j30?.projected_balance),
    projected_cash_balance_j60: round2(j60?.projected_balance),
    current_stock_alerts: Number(stockAlerts.length || 0),
    low_rotation_products_count: Number(lowRotationProducts.length || 0),
    budget_variance_usd: round2(budgetComparison?.summary?.total_variance),
    supplier_balance_due_usd: round2(
      purchaseInvoiceSummary?.summary?.total_balance_due
    ),
    production_batches_recent: Number(productionSummary?.summary?.total_batches || 0),
    signals: signals.slice(0, 6)
  };
}

function buildEnterpriseHighlights({
  commercialSummary,
  cashSummary,
  accountingHealth,
  purchaseInvoiceSummary,
  purchaseOrderSummary,
  productionSummary,
  budgetComparison,
  monthlyClosePack,
  predictiveSignals
}) {
  return [
    commercialSummary
      ? `Commercial: ${round2(
          commercialSummary.summary.total_sales_amount
        )} USD de ventes, marge ${round2(
          commercialSummary.summary.gross_margin_percent
        )}%, encours clients ${round2(
          commercialSummary.summary.total_receivables
        )} USD.`
      : null,
    cashSummary
      ? `Tresorerie: base cash ${round2(
          cashSummary.summary.current_cash_base
        )} USD (caisse ${round2(
          cashSummary.summary.cash_on_hand_base
        )}, banque ${round2(
          cashSummary.summary.bank_base
        )}, mobile money ${round2(
          cashSummary.summary.mobile_money_base
        )}), projection J+30 ${round2(
          predictiveSignals.projected_cash_balance_j30
        )} USD, dettes fournisseurs ouvertes ${round2(
          cashSummary.summary.open_payables
        )} USD.`
      : null,
    purchaseInvoiceSummary
      ? `Achats/fournisseurs: ${purchaseInvoiceSummary.summary.total_invoices} facture(s) fournisseur, ${round2(
          purchaseInvoiceSummary.summary.total_balance_due
        )} USD a regler, ${purchaseOrderSummary?.summary?.open_orders || 0} commande(s) encore ouverte(s).`
      : null,
    productionSummary
      ? `Production: ${productionSummary.summary.total_batches} batch(s) recent(s), ${round2(
          productionSummary.summary.total_quantity_produced
        )} unites produites.`
      : null,
    accountingHealth
      ? `Comptabilite: statut ${accountingHealth.status}, ${Number(
          accountingHealth.totals.draft_entries || 0
        )} brouillon(s), ${Number(
          accountingHealth.totals.imbalanced_entries || 0
        )} ecriture(s) desequilibree(s).`
      : null,
    budgetComparison
      ? `Budget: ${budgetComparison.budget.name}, ecart realise-budget ${round2(
          budgetComparison.summary.total_variance
        )} USD, atteinte ${round2(
          budgetComparison.summary.attainment_percent
        )}%.`
      : null,
    monthlyClosePack
      ? `Cloture ${monthlyClosePack.period.label}: statut ${monthlyClosePack.close_checklist.close_status}, ${Number(
          monthlyClosePack.close_checklist.critical_count || 0
        )} point(s) critique(s).`
      : null,
    predictiveSignals?.signals?.[0] || null
  ].filter(Boolean);
}

function buildFallbackReasoningMetrics(contextData = {}) {
  const executive = contextData.executive_snapshot || {};
  const treasury = contextData?.sectors?.treasury?.summary || {};
  const accountingHealth = contextData?.sectors?.accounting?.health || {};
  const predictive = contextData?.predictive_signals || {};
  const budget = contextData?.sectors?.budget?.summary || {};

  return sanitizeMetrics({
    total_sales_amount: round2(executive.total_sales_amount),
    total_receivables: round2(executive.total_receivables),
    gross_margin_percent: round2(executive.gross_margin_percent),
    current_cash_base: round2(treasury.current_cash_base),
    cash_on_hand_base: round2(treasury.cash_on_hand_base),
    bank_base: round2(treasury.bank_base),
    mobile_money_base: round2(treasury.mobile_money_base),
    overdue_receivables: round2(treasury.overdue_receivables),
    open_payables: round2(treasury.open_payables),
    projected_cash_balance_j30: round2(predictive.projected_cash_balance_j30),
    stock_alerts_count: Number(predictive.current_stock_alerts || 0),
    budget_variance_usd: round2(budget.total_variance),
    accounting_health_status: accountingHealth.status || "attention"
  });
}

function buildFallbackReasoningActions(contextData = {}) {
  const treasury = contextData?.sectors?.treasury?.summary || {};
  const stockAlerts = contextData?.sectors?.stock?.alerts || [];
  const decliningProducts =
    contextData?.sectors?.commercial?.declining_products || [];
  const dormantClients =
    contextData?.sectors?.commercial?.reactivation_candidates || [];
  const accountingIssues = contextData?.sectors?.accounting?.health?.issues || [];
  const productionSummary = contextData?.sectors?.production?.summary || {};
  const budgetSummary = contextData?.sectors?.budget?.summary || {};
  const actions = [];

  if (Number(treasury.overdue_receivables || 0) > 0) {
    actions.push(
      `Lancer un plan de recouvrement cible sur ${round2(
        treasury.overdue_receivables
      )} USD de creances echees.`
    );
  }

  if (stockAlerts.length > 0) {
    actions.push(
      `Securiser immediatement le stock de ${stockAlerts[0].product_name} sur ${stockAlerts[0].warehouse_name}.`
    );
  }

  if (decliningProducts.length > 0) {
    actions.push(
      `Relancer la performance du produit ${decliningProducts[0].product_name} en recul commercial.`
    );
  }

  if (dormantClients.length > 0) {
    actions.push(
      `Reactiver le client ${dormantClients[0].business_name} pour remettre du volume sans acquisition longue.`
    );
  }

  if (Number(productionSummary.total_batches || 0) === 0) {
    actions.push(
      "Programmer un plan de production pour soutenir les ventes et eviter la rupture sur les produits leaders."
    );
  }

  if (accountingIssues.length > 0) {
    actions.push(
      `Regulariser le point comptable prioritaire suivant: ${accountingIssues[0]}.`
    );
  }

  if (Number(budgetSummary.total_variance || 0) > 0) {
    actions.push(
      `Corriger le depassement budgetaire cumule de ${round2(
        budgetSummary.total_variance
      )} USD.`
    );
  }

  return actions.slice(0, 6);
}

function enrichReasoningResponsePayload(payload = {}, contextData = {}) {
  const metrics =
    payload.metrics && Object.keys(payload.metrics).length > 0
      ? payload.metrics
      : buildFallbackReasoningMetrics(contextData);
  const recommendations =
    Array.isArray(payload.recommendations) && payload.recommendations.length > 0
      ? payload.recommendations
      : buildFallbackReasoningActions(contextData);
  const actions =
    Array.isArray(payload.actions) && payload.actions.length > 0
      ? payload.actions
      : recommendations;

  return {
    ...payload,
    metrics,
    recommendations,
    actions
  };
}

function buildAccountingHighlights({
  accountingSummary,
  incomeStatement,
  balanceSheet,
  trialBalance,
  monthlyOverview,
  recentEntries,
  recentPayments,
  expenses
}) {
  const latestPeriod = monthlyOverview[monthlyOverview.length - 1] || null;
  const topExpense = getTopExpenseCategories(expenses, 1)[0] || null;
  const latestPayment = recentPayments[0] || null;
  const latestEntry = recentEntries[0] || null;

  return [
    `Comptabilite: ${accountingSummary.posted_entries} ecritures validees, ${accountingSummary.draft_entries} brouillons, ecart debit-credit ${round2(accountingSummary.posted_balance_gap)} USD.`,
    `Resultat: produits ${round2(incomeStatement?.totals?.total_revenue)} USD, charges ${round2(incomeStatement?.totals?.total_expense)} USD, net ${round2(incomeStatement?.totals?.net_result)} USD.`,
    `Bilan: actifs ${round2(balanceSheet?.totals?.total_assets)} USD, passifs ${round2(balanceSheet?.totals?.total_liabilities)} USD, capitaux propres ${round2(balanceSheet?.totals?.total_equity)} USD, ecart ${round2(balanceSheet?.totals?.gap)} USD.`,
    `Balance generale: debit ${round2(trialBalance?.totals?.total_debit)} USD, credit ${round2(trialBalance?.totals?.total_credit)} USD, ecart ${round2(trialBalance?.totals?.trial_gap)} USD.`,
    latestPeriod
      ? `Derniere periode comptable ${latestPeriod.period}: ${latestPeriod.total_entries} ecritures, ecart ${round2(latestPeriod.balance_gap)} USD.`
      : null,
    topExpense
      ? `Charge dominante: ${topExpense.category}, ${round2(topExpense.total_amount)} USD.`
      : null,
    latestPayment
      ? `Dernier paiement: ${latestPayment.customer_name}, ${round2(latestPayment.amount)} USD le ${latestPayment.payment_date}.`
      : null,
    latestEntry
      ? `Derniere ecriture: ${latestEntry.entry_number} (${latestEntry.journal_code}) statut ${latestEntry.status}.`
      : null
  ].filter(Boolean);
}

function buildReasoningHighlights({
  globalStats,
  stockAlerts,
  topProducts,
  topCustomers,
  expenses,
  recentInvoices,
  accounting,
  recentEntries,
  businessRules
}) {
  const cashThreshold = Number(
    businessRules.minimum_cash_threshold_usd || 3000
  );
  const topCustomer = topCustomers[0] || null;
  const topProduct = topProducts[0] || null;
  const topStockAlert = stockAlerts[0] || null;
  const topExpenseCategory = getTopExpenseCategories(expenses, 1)[0] || null;
  const latestInvoice = recentInvoices[0] || null;
  const latestEntry = recentEntries[0] || null;

  return [
    `Ventes ${round2(globalStats.total_sales_amount)} USD, encaissements ${round2(globalStats.total_collected_amount)} USD, creances ${round2(globalStats.total_receivables)} USD.`,
    `Tresorerie ${round2(globalStats.total_collected_amount)} USD pour seuil minimal ${round2(cashThreshold)} USD.`,
    `Stock total ${Number(globalStats.total_units_in_stock || 0)} unites, alertes stock ${stockAlerts.length}.`,
    topProduct
      ? `Produit leader: ${topProduct.product_name}, ${Number(topProduct.total_quantity_sold || 0)} unites, ${round2(topProduct.total_sales_value)} USD.`
      : null,
    topCustomer
      ? `Client principal: ${topCustomer.business_name}, encours ${round2(topCustomer.total_balance_due)} USD.`
      : null,
    topStockAlert
      ? `Alerte stock: ${topStockAlert.product_name}, stock ${Number(topStockAlert.quantity || 0)} pour seuil ${Number(topStockAlert.alert_threshold || 0)}.`
      : null,
    topExpenseCategory
      ? `Depense principale: ${topExpenseCategory.category}, ${round2(topExpenseCategory.total_amount)} USD.`
      : null,
    latestInvoice
      ? `Derniere facture: ${latestInvoice.invoice_number}, statut ${latestInvoice.status}, solde ${round2(latestInvoice.balance_due)} USD.`
      : null,
    `Comptabilite: ${Number(accounting.posted_entries || 0)} ecritures validees, ${Number(accounting.draft_entries || 0)} brouillons.`,
    latestEntry
      ? `Derniere ecriture: ${latestEntry.entry_number} (${latestEntry.journal_code}).`
      : null
  ].filter(Boolean);
}

async function buildReasoningContextData(
  intent,
  businessRules = {},
  period = "current"
) {
  const focus = getReasoningFocus(intent);
  const reportingRange = getReasoningDateRange(period);
  const previousClosedMonth = getPreviousClosedMonth();
  const [
    globalStats,
    stockAlerts,
    lowRotationProducts,
    topProducts,
    topCustomers,
    expenses,
    recentInvoices,
    accounting,
    recentEntries,
    accountingMonthlyOverview,
    accountClassBalances,
    trialBalance,
    incomeStatement,
    balanceSheet,
    recentPayments,
    companyKnowledge,
    commercialDashboard,
    cashForecast,
    accountingHealth,
    purchaseInvoices,
    purchaseOrders,
    productionBatches,
    budgetComparison,
    monthlyClosePack
  ] = await Promise.all([
    getGlobalStats(),
    getStockAlerts(),
    safeExecute(() => getLowRotationProducts(5), []),
    getTopProducts(10),
    getTopCustomers(10),
    getAllExpenses(),
    getRecentInvoices(12),
    getAccountingGlobalStats(),
    getRecentJournalEntries(10),
    focus === "accounting" || focus === "general"
      ? getAccountingMonthlyOverview()
      : Promise.resolve([]),
    focus === "accounting" || focus === "general"
      ? getAccountClassBalances()
      : Promise.resolve([]),
    focus === "accounting" || focus === "general"
      ? getTrialBalance(reportingRange)
      : Promise.resolve({ rows: [], totals: {} }),
    focus === "accounting" || focus === "general"
      ? getIncomeStatement(reportingRange)
      : Promise.resolve({ revenues: [], expenses: [], totals: {} }),
    focus === "accounting" || focus === "general"
      ? getBalanceSheet(reportingRange)
      : Promise.resolve({ assets: [], liabilities: [], equity: [], totals: {} }),
    focus === "accounting" || focus === "cash" || focus === "general"
      ? getRecentPayments(8)
      : Promise.resolve([]),
    getActiveCompanyKnowledge({
      categories: ["company_profile", "strategy", "products", "distribution", "operations", "finance", "market", "investor_notes", "founder_notes"],
      limit: 25
    }),
    safeExecute(() => getCommercialDashboard(365, 5), null),
    safeExecute(() => getCashForecast(5), null),
    safeExecute(() => getAccountingHealthSnapshot(), null),
    safeExecute(() => getAllPurchaseInvoices(), []),
    safeExecute(() => getAllPurchaseOrders(), []),
    safeExecute(() => getProductionBatches(12), []),
    safeExecute(() => getPrimaryBudgetComparison(), null),
    safeExecute(
      () =>
        getMonthlyClosePack({
          year: previousClosedMonth.year,
          month: previousClosedMonth.month,
          detailLimit: 5
        }),
      null
    )
  ]);

  const totalExpensesAmount = expenses.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const summarizedGlobalStats = summarizeGlobalStats(globalStats);
  const summarizedAccountingStats = summarizeAccountingStats(accounting);
  const expenseCategories = getTopExpenseCategories(expenses, 3);
  const compactAccountingOverview = compactMonthlyAccountingOverview(
    accountingMonthlyOverview
  );
  const compactAccountingBalances = compactAccountClassBalances(
    accountClassBalances
  );
  const compactTrial = compactTrialBalance(trialBalance);
  const compactIncome = compactIncomeStatement(incomeStatement);
  const compactBalance = compactBalanceSheet(balanceSheet);
  const summarizedCommercialDashboard = summarizeCommercialDashboard(
    commercialDashboard
  );
  const summarizedCashForecast = summarizeCashForecast(cashForecast);
  const summarizedAccountingHealth = summarizeAccountingHealth(accountingHealth);
  const summarizedPurchaseInvoices = summarizePurchaseInvoices(purchaseInvoices);
  const summarizedPurchaseOrders = summarizePurchaseOrders(purchaseOrders);
  const summarizedProduction = summarizeProductionBatches(productionBatches);
  const summarizedBudget = summarizeBudgetComparison(budgetComparison);
  const summarizedMonthlyClose = summarizeMonthlyClosePack(monthlyClosePack);
  const highlightedInvoices = recentInvoices.slice(0, 5).map((invoice) => ({
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    status: invoice.status,
    customer_name: invoice.customer_name,
    total_amount: round2(invoice.total_amount),
    paid_amount: round2(invoice.paid_amount),
    balance_due: round2(invoice.balance_due)
  }));
  const highlightedProducts = topProducts.slice(0, 5).map((product) => ({
    product_name: product.product_name,
    sku: product.sku,
    total_quantity_sold: Number(product.total_quantity_sold || 0),
    total_sales_value: round2(product.total_sales_value),
    gross_profit_amount: round2(product.gross_profit_amount)
  }));
  const highlightedCustomers = topCustomers.slice(0, 5).map((customer) => ({
    business_name: customer.business_name,
    city: customer.city || null,
    total_billed: round2(customer.total_billed),
    total_paid: round2(customer.total_paid),
    total_balance_due: round2(customer.total_balance_due)
  }));
  const highlightedStockAlerts = stockAlerts.slice(0, 5).map((alert) => ({
    product_name: alert.product_name,
    warehouse_name: alert.warehouse_name,
    quantity: Number(alert.quantity || 0),
    alert_threshold: Number(alert.alert_threshold || 0)
  }));
  const highlightedEntries = recentEntries.slice(0, 5).map((entry) => ({
    entry_number: entry.entry_number,
    entry_date: entry.entry_date,
    journal_code: entry.journal_code,
    description: entry.description,
    status: entry.status,
    total_debit: round2(entry.total_debit),
    total_credit: round2(entry.total_credit)
  }));
  const highlightedPayments = recentPayments.slice(0, 5).map((payment) => ({
    payment_date: payment.payment_date,
    customer_name: payment.customer_name,
    invoice_number: payment.invoice_number,
    payment_method: payment.payment_method,
    amount: round2(payment.amount)
  }));
  const highlightedReceivableCustomers = getTopReceivableCustomers(
    topCustomers,
    5
  ).map((customer) => ({
    business_name: customer.business_name,
    city: customer.city || null,
    total_billed: round2(customer.total_billed),
    total_paid: round2(customer.total_paid),
    total_balance_due: round2(customer.total_balance_due)
  }));
  const highlightedLowRotationProducts = (lowRotationProducts || [])
    .slice(0, 5)
    .map((product) => ({
      product_name: product.product_name,
      sku: product.sku,
      category: product.category || null,
      total_quantity_sold: Number(product.total_quantity_sold || 0)
    }));
  const highlightedKnowledge = compactCompanyKnowledge(companyKnowledge).slice(
    0,
    5
  );
  const predictiveSignals = buildPredictiveSignals({
    businessRules,
    commercialDashboard: commercialDashboard || {},
    cashForecast: cashForecast || {},
    stockAlerts,
    lowRotationProducts,
    budgetComparison: summarizedBudget,
    purchaseInvoiceSummary: summarizedPurchaseInvoices,
    productionSummary: summarizedProduction
  });
  const executiveSnapshot = {
    ...summarizedGlobalStats,
    current_cash_base: round2(summarizedCashForecast?.summary?.current_cash_base),
    cash_on_hand_base: round2(
      summarizedCashForecast?.summary?.cash_on_hand_base
    ),
    bank_base: round2(summarizedCashForecast?.summary?.bank_base),
    mobile_money_base: round2(
      summarizedCashForecast?.summary?.mobile_money_base
    ),
    open_payables: round2(summarizedCashForecast?.summary?.open_payables),
    projected_cash_balance_j30: round2(
      predictiveSignals.projected_cash_balance_j30
    ),
    accounting_health_status: summarizedAccountingHealth?.status || "attention",
    budget_variance_usd: round2(summarizedBudget?.summary?.total_variance)
  };
  const sectors = {
    commercial: summarizedCommercialDashboard,
    treasury: summarizedCashForecast,
    stock: {
      alerts: highlightedStockAlerts,
      low_rotation_products: highlightedLowRotationProducts,
      top_products: highlightedProducts
    },
    customers: {
      top_receivables: highlightedReceivableCustomers,
      top_customers: highlightedCustomers,
      receivables_due_soon:
        summarizedCashForecast?.receivables_due_soon?.slice(0, 5) || [],
      recent_invoices: highlightedInvoices
    },
    expenses: {
      total_amount: round2(totalExpensesAmount),
      count: expenses.length,
      top_categories: expenseCategories,
      recent_items: expenses.slice(0, 5).map((expense) => ({
        expense_date: expense.expense_date,
        category: expense.category,
        description: expense.description,
        amount: round2(expense.amount)
      }))
    },
    accounting: {
      summary: summarizedAccountingStats,
      health: summarizedAccountingHealth,
      monthly_overview: compactAccountingOverview,
      account_class_balances: compactAccountingBalances,
      trial_balance: compactTrial,
      income_statement: compactIncome,
      balance_sheet: compactBalance,
      recent_entries: highlightedEntries,
      recent_payments: highlightedPayments,
      reporting_highlights: buildAccountingHighlights({
        accountingSummary: summarizedAccountingStats,
        incomeStatement: compactIncome,
        balanceSheet: compactBalance,
        trialBalance: compactTrial,
        monthlyOverview: compactAccountingOverview,
        recentEntries: highlightedEntries,
        recentPayments: highlightedPayments,
        expenses
      })
    },
    procurement: {
      purchase_invoices: summarizedPurchaseInvoices,
      purchase_orders: summarizedPurchaseOrders,
      payables_due_soon:
        summarizedCashForecast?.payables_due_soon?.slice(0, 5) || []
    },
    production: summarizedProduction,
    budget: summarizedBudget,
    monthly_close: summarizedMonthlyClose,
    forecasting: predictiveSignals
  };
  const focusDataMap = {
    sales: sectors.commercial,
    stock: sectors.stock,
    customers: sectors.customers,
    expenses: sectors.expenses,
    procurement: sectors.procurement,
    production: sectors.production,
    budget: sectors.budget,
    forecast: sectors.forecasting,
    cash: sectors.treasury,
    accounting: sectors.accounting
  };

  const baseContext = {
    focus,
    reporting_period: reportingRange,
    executive_snapshot: executiveSnapshot,
    executive_highlights: buildReasoningHighlights({
      globalStats: summarizedGlobalStats,
      stockAlerts,
      topProducts,
      topCustomers,
      expenses,
      recentInvoices,
      accounting: summarizedAccountingStats,
      recentEntries,
      businessRules
    }),
    enterprise_highlights: buildEnterpriseHighlights({
      commercialSummary: summarizedCommercialDashboard,
      cashSummary: summarizedCashForecast,
      accountingHealth: summarizedAccountingHealth,
      purchaseInvoiceSummary: summarizedPurchaseInvoices,
      purchaseOrderSummary: summarizedPurchaseOrders,
      productionSummary: summarizedProduction,
      budgetComparison: summarizedBudget,
      monthlyClosePack: summarizedMonthlyClose,
      predictiveSignals
    }),
    accounting_reporting_highlights: sectors.accounting.reporting_highlights,
    predictive_signals: predictiveSignals,
    sectors
  };

  return {
    ...baseContext,
    focus_data: focusDataMap[focus] || sectors.commercial,
    knowledge: highlightedKnowledge
  };
}

function getTopExpenseCategories(expenses = [], limit = 5) {
  const grouped = new Map();

  for (const expense of expenses) {
    const key = String(expense.category || "non_classe").trim();
    const current = Number(grouped.get(key) || 0);
    grouped.set(key, current + Number(expense.amount || 0));
  }

  return Array.from(grouped.entries())
    .map(([category, total_amount]) => ({
      category,
      total_amount: round2(total_amount)
    }))
    .sort((a, b) => Number(b.total_amount) - Number(a.total_amount))
    .slice(0, limit);
}

function getTopReceivableCustomers(customers = [], limit = 5) {
  return [...customers]
    .sort(
      (a, b) =>
        Number(b.total_balance_due || 0) - Number(a.total_balance_due || 0)
    )
    .slice(0, limit);
}

function scoreStockAlert(alert, businessRules) {
  let score = 0;

  const quantity = Number(alert.quantity || 0);
  const threshold = Number(alert.alert_threshold || 0);

  if (quantity <= 0) score += 5;
  if (quantity <= threshold) score += 3;

  if (isStrategicProduct(alert.product_name, businessRules)) score += 5;
  if (isPriorityCity(alert.city || alert.warehouse_city, businessRules)) score += 3;
  if (isPriorityChannel(alert.warehouse_name, businessRules)) score += 2;

  return score;
}

function getStrategicProductsFromTopProducts(topProducts = [], businessRules) {
  return topProducts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );
}

async function analyzeSalesOverview(businessRules) {
  const [stats, topProducts, topCustomers] = await Promise.all([
    getGlobalStats(),
    getTopProducts(10),
    getTopCustomers(10)
  ]);

  const totalSales = Number(stats?.total_sales_amount || 0);
  const totalCollected = Number(stats?.total_collected_amount || 0);
  const totalReceivables = Number(stats?.total_receivables || 0);

  const strategicProducts = getStrategicProductsFromTopProducts(
    topProducts,
    businessRules
  );

  const priorityCustomers = topCustomers.filter(
    (row) =>
      Number(row.total_balance_due || 0) > 0 &&
      isPriorityCity(row.city, businessRules)
  );

  const recommendations = [];

  if (strategicProducts.length > 0) {
    recommendations.push(
      "Sécuriser la disponibilité des produits stratégiques les plus vendeurs."
    );
  }

  if (priorityCustomers.length > 0) {
    recommendations.push(
      "Suivre en priorité les créances des clients situés dans les villes prioritaires."
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Maintenir la pression commerciale sur les produits à meilleure rotation."
    );
  }

  return {
    source_module: "sales",
    summary: `Les ventes cumulées s’élèvent à ${round2(totalSales)} USD.`,
    answer:
      `Le chiffre d’affaires cumulé est de ${round2(totalSales)} USD, avec ${round2(totalCollected)} USD encaissés et ${round2(totalReceivables)} USD encore en créances. ` +
      `Le pilotage doit rester centré sur les produits stratégiques et les canaux prioritaires de KIVU AGRO BIO.`,
    metrics: {
      total_sales_amount: round2(totalSales),
      total_collected_amount: round2(totalCollected),
      total_receivables: round2(totalReceivables),
      strategic_products_in_top_sales: strategicProducts.length,
      priority_customers_with_receivables: priorityCustomers.length
    },
    drivers: [
      ...strategicProducts.slice(0, 5).map(
        (row) =>
          `Produit stratégique en tête : ${row.product_name} (${Number(
            row.total_quantity_sold || 0
          )} unités vendues)`
      ),
      ...priorityCustomers.slice(0, 3).map(
        (row) =>
          `Client prioritaire avec créance : ${row.business_name} (${round2(
            row.total_balance_due
          )} USD)`
      )
    ],
    recommendations
  };
}

async function analyzeSalesVariance(businessRules) {
  const [invoices, topProducts, stockAlerts] = await Promise.all([
    getAllInvoices(),
    getTopProducts(10),
    getStockAlerts()
  ]);

  const totalInvoices = invoices.length;
  const totalSales = invoices.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );
  const totalBalanceDue = invoices.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );

  const strategicProducts = getStrategicProductsFromTopProducts(
    topProducts,
    businessRules
  );

  const strategicStockAlerts = stockAlerts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "sales",
    summary:
      "La variation des ventes doit être lue avec les produits stratégiques, le niveau de créances et les tensions de stock.",
    answer:
      `Sur les données actuelles, ${totalInvoices} factures représentent ${round2(totalSales)} USD de ventes et ${round2(totalBalanceDue)} USD de créances. ` +
      `Chez KIVU AGRO BIO, une baisse de performance commerciale doit être analysée d’abord sur les produits stratégiques et les canaux majeurs.`,
    metrics: {
      total_invoices: totalInvoices,
      total_sales_amount: round2(totalSales),
      total_receivables: round2(totalBalanceDue),
      strategic_products_count: strategicProducts.length,
      strategic_stock_alerts_count: strategicStockAlerts.length
    },
    drivers: [
      `Produits stratégiques présents parmi les meilleures ventes : ${strategicProducts.length}`,
      `Alertes stock touchant des produits stratégiques : ${strategicStockAlerts.length}`,
      `Créances ouvertes à suivre : ${round2(totalBalanceDue)} USD`
    ],
    recommendations: [
      "Analyser d’abord les ruptures touchant les produits stratégiques.",
      "Protéger les canaux structurants avant les canaux secondaires.",
      "Relancer en priorité les clients majeurs avec encours."
    ]
  };
}

async function analyzeStockPriority(businessRules) {
  const alerts = await getStockAlerts();

  const scored = [...alerts]
    .map((row) => ({
      ...row,
      priority_score: scoreStockAlert(row, businessRules)
    }))
    .sort((a, b) => Number(b.priority_score) - Number(a.priority_score));

  const criticalItems = scored.slice(0, 5);
  const strategicItems = scored.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "stock",
    summary:
      criticalItems.length > 0
        ? `${criticalItems.length} alertes stock prioritaires ont été identifiées.`
        : "Aucune alerte stock critique n’est détectée actuellement.",
    answer:
      criticalItems.length > 0
        ? "Le réapprovisionnement doit d’abord protéger les produits stratégiques et les villes prioritaires de KIVU AGRO BIO."
        : "Le stock ne présente pas de rupture critique immédiate selon les règles actuelles.",
    metrics: {
      critical_items_count: alerts.length,
      priority_items_count: criticalItems.length,
      strategic_items_in_alert: strategicItems.length
    },
    drivers: criticalItems.map(
      (row) =>
        `${row.product_name} - stock ${Number(row.quantity || 0)} / seuil ${Number(
          row.alert_threshold || 0
        )} - score ${Number(row.priority_score || 0)}`
    ),
    recommendations:
      criticalItems.length > 0
        ? [
            "Réapprovisionner en priorité les produits stratégiques en alerte.",
            "Arbitrer les stocks selon les villes prioritaires avant les autres zones.",
            "Contrôler les articles qui combinent forte rotation et stock inférieur au seuil."
          ]
        : [
            "Maintenir la surveillance des seuils et des produits stratégiques.",
            "Préparer les prochains besoins sur les références les plus vendues."
          ]
  };
}

async function analyzeReceivablesRisk(businessRules) {
  const topCustomers = await getTopCustomers(10);
  const risky = getTopReceivableCustomers(topCustomers, 10);

  const riskyPriorityCustomers = risky.filter((row) =>
    isPriorityCity(row.city, businessRules)
  );

  const totalReceivables = risky.reduce(
    (sum, row) => sum + Number(row.total_balance_due || 0),
    0
  );

  return {
    source_module: "customers",
    summary:
      risky.length > 0
        ? `Les principaux clients débiteurs concentrent ${round2(totalReceivables)} USD de créances.`
        : "Aucun client débiteur majeur n’a été identifié.",
    answer:
      risky.length > 0
        ? "Les clients situés dans les villes prioritaires doivent être traités en premier, car leur poids commercial est plus structurant pour KIVU AGRO BIO."
        : "Le portefeuille client ne montre pas de concentration forte des créances sur les données disponibles.",
    metrics: {
      risky_customers_count: risky.length,
      total_receivables_top_customers: round2(totalReceivables),
      risky_priority_customers_count: riskyPriorityCustomers.length
    },
    drivers: risky.slice(0, 5).map(
      (row) =>
        `${row.business_name} (${row.city || "ville inconnue"}) : ${round2(
          row.total_balance_due
        )} USD`
    ),
    recommendations:
      risky.length > 0
        ? [
            "Relancer d’abord les clients débiteurs des villes prioritaires.",
            "Limiter le crédit sur les comptes à encours répétés.",
            "Suivre les grands distributeurs sans casser la relation commerciale."
          ]
        : [
            "Maintenir un suivi régulier des créances.",
            "Conserver la discipline d’encaissement actuelle."
          ]
  };
}

async function analyzeExpenses(businessRules) {
  const expenses = await getAllExpenses();
  const topCategories = getTopExpenseCategories(expenses, 5);

  const totalExpenses = expenses.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const targetMargin = businessRules.target_net_margin_range || {
    min: 25,
    max: 30
  };

  return {
    source_module: "expenses",
    summary: `Les dépenses enregistrées totalisent ${round2(totalExpenses)} USD.`,
    answer:
      "Chez KIVU AGRO BIO, les dépenses doivent être lues non seulement par montant, mais aussi par utilité stratégique : distribution, acquisition commerciale, logistique et disponibilité produit.",
    metrics: {
      total_expenses: round2(totalExpenses),
      expense_count: expenses.length,
      target_net_margin_min: Number(targetMargin.min || 25),
      target_net_margin_max: Number(targetMargin.max || 30)
    },
    drivers: topCategories.map(
      (row) => `${row.category} : ${round2(row.total_amount)} USD`
    ),
    recommendations:
      topCategories.length > 0
        ? [
            "Réduire d’abord les charges peu liées à la distribution ou à la croissance.",
            "Tolérer davantage les dépenses qui soutiennent les canaux prioritaires et la disponibilité produit.",
            "Comparer les charges totales à la marge cible définie par KIVU AGRO BIO."
          ]
        : [
            "Continuer à structurer les catégories de dépense.",
            "Enrichir l’historique pour améliorer la lecture des charges."
          ]
  };
}

async function analyzeCashPosition(businessRules) {
  const stats = await getGlobalStats();

  const collected = Number(stats?.total_collected_amount || 0);
  const payments = Number(stats?.total_payments_received || 0);
  const receivables = Number(stats?.total_receivables || 0);
  const minimumCashThreshold = Number(
    businessRules.minimum_cash_threshold_usd || 3000
  );

  const pressure = collected < minimumCashThreshold;

  return {
    source_module: "cash",
    summary:
      `Les encaissements cumulés sont de ${round2(collected)} USD, avec ${round2(receivables)} USD encore à recouvrer.`,
    answer:
      pressure
        ? "Le niveau de liquidité observé est sous le seuil de vigilance métier défini pour KIVU AGRO BIO. Il faut protéger le cash à court terme."
        : "Le niveau de liquidité reste au-dessus du seuil minimal de vigilance actuellement défini.",
    metrics: {
      total_collected_amount: round2(collected),
      total_payments_received: round2(payments),
      total_receivables: round2(receivables),
      minimum_cash_threshold_usd: minimumCashThreshold
    },
    drivers: [
      `Encaissements cumulés : ${round2(collected)} USD`,
      `Créances ouvertes : ${round2(receivables)} USD`,
      `Seuil minimum cash : ${round2(minimumCashThreshold)} USD`
    ],
    recommendations: pressure
      ? [
          "Accélérer les encaissements sur les clients les plus exposés.",
          "Reporter les dépenses non urgentes.",
          "Réserver la trésorerie disponible aux stocks stratégiques et à la distribution."
        ]
      : [
          "Maintenir le niveau d’encaissement actuel.",
          "Surveiller les créances et éviter l’accumulation de charges peu stratégiques."
        ]
  };
}

async function analyzeAccounting(period = "current") {
  const reportingRange = getReasoningDateRange(period);
  const [
    stats,
    recentEntries,
    monthlyOverview,
    incomeStatement,
    balanceSheet,
    trialBalance
  ] = await Promise.all([
    getAccountingGlobalStats(),
    getRecentJournalEntries(5),
    getAccountingMonthlyOverview(),
    getIncomeStatement(reportingRange),
    getBalanceSheet(reportingRange),
    getTrialBalance(reportingRange)
  ]);

  const accountingSummary = summarizeAccountingStats(stats);
  const compactMonthly = compactMonthlyAccountingOverview(monthlyOverview);
  const compactIncome = compactIncomeStatement(incomeStatement);
  const compactBalance = compactBalanceSheet(balanceSheet);
  const compactTrial = compactTrialBalance(trialBalance);

  return {
    source_module: "accounting",
    summary:
      `La comptabilité comporte ${Number(stats?.posted_entries || 0)} écritures validées et ${Number(stats?.draft_entries || 0)} brouillons.`,
    answer:
      "La lecture comptable immédiate repose sur le volume des écritures validées, l’équilibre débit/crédit et les derniers mouvements passés.",
    metrics: {
      total_accounts: Number(stats?.total_accounts || 0),
      total_entries: Number(stats?.total_entries || 0),
      posted_entries: Number(stats?.posted_entries || 0),
      draft_entries: Number(stats?.draft_entries || 0),
      total_posted_debit: round2(stats?.total_posted_debit || 0),
      total_posted_credit: round2(stats?.total_posted_credit || 0)
    },
    drivers: recentEntries.map(
      (row) => `${row.entry_number} - ${row.journal_code} - ${row.description}`
    ),
    recommendations: [
      "Surveiller les brouillons non validés.",
      "Contrôler régulièrement les journaux à plus forte fréquence."
    ]
  };
}

async function analyzeAccountingReporting(period = "current") {
  const reportingRange = getReasoningDateRange(period);
  const [
    stats,
    recentEntries,
    monthlyOverview,
    incomeStatement,
    balanceSheet,
    trialBalance
  ] = await Promise.all([
    getAccountingGlobalStats(),
    getRecentJournalEntries(5),
    getAccountingMonthlyOverview(),
    getIncomeStatement(reportingRange),
    getBalanceSheet(reportingRange),
    getTrialBalance(reportingRange)
  ]);

  const accountingSummary = summarizeAccountingStats(stats);
  const compactMonthly = compactMonthlyAccountingOverview(monthlyOverview);
  const compactIncome = compactIncomeStatement(incomeStatement);
  const compactBalance = compactBalanceSheet(balanceSheet);
  const compactTrial = compactTrialBalance(trialBalance);

  return {
    source_module: "accounting",
    summary:
      `Reporting comptable ${reportingRange.label}: ${accountingSummary.posted_entries} ecritures validees, resultat net ${round2(compactIncome.totals.net_result)} USD, ecart bilan ${round2(compactBalance.totals.gap)} USD.`,
    answer:
      `Le reporting comptable met en avant ${round2(compactIncome.totals.total_revenue)} USD de produits, ${round2(compactIncome.totals.total_expense)} USD de charges et un resultat net de ${round2(compactIncome.totals.net_result)} USD. ` +
      `Le bilan ressort a ${round2(compactBalance.totals.total_assets)} USD d'actifs pour ${round2(compactBalance.totals.total_liabilities_and_equity)} USD de passif plus capitaux propres, avec un ecart de ${round2(compactBalance.totals.gap)} USD. ` +
      `La direction doit suivre la discipline de cloture, les brouillons non postes et les comptes qui portent les plus gros soldes.`,
    metrics: {
      ...accountingSummary,
      total_revenue: round2(compactIncome.totals.total_revenue),
      total_expense: round2(compactIncome.totals.total_expense),
      net_result: round2(compactIncome.totals.net_result),
      total_assets: round2(compactBalance.totals.total_assets),
      total_liabilities_and_equity: round2(
        compactBalance.totals.total_liabilities_and_equity
      ),
      balance_sheet_gap: round2(compactBalance.totals.gap),
      trial_balance_gap: round2(compactTrial.totals.trial_gap)
    },
    drivers: [
      ...compactMonthly.map(
        (row) =>
          `Periode ${row.period}: ${row.total_entries} ecritures, ecart ${round2(row.balance_gap)} USD`
      ),
      ...recentEntries.map(
        (row) => `${row.entry_number} - ${row.journal_code} - ${row.description}`
      )
    ].slice(0, 5),
    recommendations: [
      "Surveiller les brouillons non valides avant cloture.",
      "Verifier l'alignement debit-credit et investiguer tout ecart de balance.",
      "Suivre les comptes de charges et de produits dominants pour les commentaires de reporting."
    ]
  };
}

async function analyzeBusinessOverview(businessRules) {
  const [globalStats, accountingStats, stockAlerts] = await Promise.all([
    getGlobalStats(),
    getAccountingGlobalStats(),
    getStockAlerts()
  ]);

  const strategicStockAlerts = stockAlerts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "business",
    summary: "Vue synthétique de la situation commerciale, stock et comptable.",
    answer:
      `L’activité montre ${round2(globalStats?.total_sales_amount || 0)} USD de ventes cumulées, ${round2(globalStats?.total_receivables || 0)} USD de créances, ${Number(stockAlerts.length || 0)} alertes stock et ${Number(accountingStats?.posted_entries || 0)} écritures validées. ` +
      `Le pilotage doit se concentrer en priorité sur les produits et canaux structurants.`,
    metrics: {
      total_sales_amount: round2(globalStats?.total_sales_amount || 0),
      total_receivables: round2(globalStats?.total_receivables || 0),
      stock_alerts_count: Number(stockAlerts.length || 0),
      strategic_stock_alerts_count: strategicStockAlerts.length,
      posted_entries: Number(accountingStats?.posted_entries || 0)
    },
    drivers: [
      "Croiser ventes, stock, créances et comptabilité.",
      `Alertes stock sur produits stratégiques : ${strategicStockAlerts.length}`
    ],
    recommendations: [
      "Traiter d’abord les alertes stock qui touchent les produits stratégiques.",
      "Relancer les clients majeurs à créance élevée.",
      "Piloter les décisions à partir des données comptables déjà validées."
    ]
  };
}

function pushHistory(item) {
  aiHistory.unshift(item);

  if (aiHistory.length > 20) {
    aiHistory.pop();
  }
}

export async function askAIQuestion({ question, context = {} }) {
  const intentResult = detectIntent(question);
  const businessRules = await getBusinessRulesMap();
  const assistantBudgetMs = Math.min(
    getEnvNumber("AI_ASSISTANT_TIMEOUT_MS", 90000),
    115000
  );

  const useReasoning =
    String(process.env.AI_REASONING_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false";

  if (useReasoning) {
    try {
      const contextData = await buildReasoningContextData(
        intentResult.intent,
        businessRules,
        intentResult.period
      );

      const mergedContextData =
        context && typeof context === "object" && Object.keys(context).length > 0
          ? {
              ...contextData,
              userContext: context
            }
          : contextData;

      const reasoning = await withTimeout(
        runDeepseekReasoning({
          question,
          businessRules: compactBusinessRulesForReasoning(businessRules),
          contextData: mergedContextData,
          profile: "assistant"
        }),
        assistantBudgetMs,
        "Assistant reasoning"
      );

      const response = {
        intent: "ai_reasoning",
        period: "global",
        source_module: "ai_assistant",
        summary: reasoning.summary || "",
        answer: reasoning.analysis || "",
        metrics: reasoning.metrics || {},
        drivers: [
          ...(reasoning.risks || []).map((item) => `Risque: ${item}`),
          ...(reasoning.opportunities || []).map(
            (item) => `Opportunité: ${item}`
          )
        ],
        recommendations:
          reasoning.actions || reasoning.recommendations || [],
        priority_level: reasoning.priority_level || "MEDIUM",
        confidence_score: reasoning.confidence_score || 0.95,
        generated_at: new Date().toISOString()
      };

      const safeResponse = sanitizeReasoningResponse(
        {
          ...reasoning,
          generated_at: response.generated_at
        },
        intentResult.period || "global"
      );
      const enrichedResponse = enrichReasoningResponsePayload(
        safeResponse,
        mergedContextData
      );

      pushHistory({
        question,
        intent: enrichedResponse.intent,
        summary: enrichedResponse.summary,
        created_at: enrichedResponse.generated_at
      });

      return enrichedResponse;
    } catch (error) {
      console.error("DeepSeek failed → fallback to existing engine:", error);
    }
  }

  let analysis;

  switch (intentResult.intent) {
    case "sales_overview":
      analysis = await analyzeSalesOverview(businessRules);
      break;
    case "sales_variance_explanation":
      analysis = await analyzeSalesVariance(businessRules);
      break;
    case "stock_priority_restock":
      analysis = await analyzeStockPriority(businessRules);
      break;
    case "customer_receivables_risk":
      analysis = await analyzeReceivablesRisk(businessRules);
      break;
    case "expense_pressure_analysis":
      analysis = await analyzeExpenses(businessRules);
      break;
    case "cash_position_analysis":
      analysis = await analyzeCashPosition(businessRules);
      break;
    case "accounting_summary":
      analysis = await analyzeAccountingReporting(intentResult.period);
      break;
    default:
      analysis = await analyzeBusinessOverview(businessRules);
      break;
  }

  const response = composeAIResponse({
    question,
    intentResult,
    analysis: {
      ...analysis,
      context,
      business_rules_applied: true
    }
  });

  pushHistory({
    question,
    intent: response.intent,
    summary: response.summary,
    created_at: response.generated_at
  });

  return response;
}

export function getQuickQuestions() {
  return quickQuestions;
}

export function getAIHistory() {
  return aiHistory;
}
