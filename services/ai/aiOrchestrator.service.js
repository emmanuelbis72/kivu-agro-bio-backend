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
  getRecentPayments
} from "../../models/dashboard.model.js";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance
} from "../../models/accountingReport.model.js";
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

function toIsoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
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
  const [
    globalStats,
    stockAlerts,
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
    companyKnowledge
  ] = await Promise.all([
    getGlobalStats(),
    getStockAlerts(),
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
    })
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
  const highlightedKnowledge = compactCompanyKnowledge(companyKnowledge).slice(
    0,
    5
  );

  const baseContext = {
    focus,
    reporting_period: reportingRange,
    executive_snapshot: summarizedGlobalStats,
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
    accounting_reporting_highlights: buildAccountingHighlights({
      accountingSummary: summarizedAccountingStats,
      incomeStatement: compactIncome,
      balanceSheet: compactBalance,
      trialBalance: compactTrial,
      monthlyOverview: compactAccountingOverview,
      recentEntries: highlightedEntries,
      recentPayments: highlightedPayments,
      expenses
    })
  };

  switch (focus) {
    case "sales":
      return {
        ...baseContext,
        sales: {
          top_products: highlightedProducts,
          top_customers: highlightedCustomers,
          recent_invoices: highlightedInvoices
        },
        knowledge: highlightedKnowledge
      };
    case "stock":
      return {
        ...baseContext,
        stock: {
          alerts: highlightedStockAlerts,
          top_products: highlightedProducts
        },
        knowledge: highlightedKnowledge
      };
    case "customers":
      return {
        ...baseContext,
        customers: {
          top_customers: highlightedCustomers,
          recent_invoices: highlightedInvoices
        },
        knowledge: highlightedKnowledge
      };
    case "expenses":
      return {
        ...baseContext,
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
        knowledge: highlightedKnowledge
      };
    case "cash":
      return {
        ...baseContext,
        cash: {
          top_customers: highlightedCustomers,
          top_expense_categories: expenseCategories,
          recent_invoices: highlightedInvoices
        },
        knowledge: highlightedKnowledge
      };
    case "accounting":
      return {
        ...baseContext,
        accounting: {
          summary: summarizedAccountingStats,
          monthly_overview: compactAccountingOverview,
          account_class_balances: compactAccountingBalances,
          trial_balance: compactTrial,
          income_statement: compactIncome,
          balance_sheet: compactBalance,
          recent_entries: highlightedEntries,
          recent_payments: highlightedPayments,
          reporting_highlights: baseContext.accounting_reporting_highlights
        },
        knowledge: highlightedKnowledge
      };
    default:
      return {
        ...baseContext,
        sales: {
          top_products: highlightedProducts,
          top_customers: highlightedCustomers,
          recent_invoices: highlightedInvoices
        },
        stock: {
          alerts: highlightedStockAlerts
        },
        expenses: {
          total_amount: round2(totalExpensesAmount),
          top_categories: expenseCategories
        },
        accounting: {
          summary: summarizedAccountingStats,
          reporting_highlights: baseContext.accounting_reporting_highlights,
          recent_entries: highlightedEntries
        },
        knowledge: highlightedKnowledge
      };
  }
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

      const reasoning = await runDeepseekReasoning({
        question,
        businessRules: compactBusinessRulesForReasoning(businessRules),
        contextData: mergedContextData,
        profile: "assistant"
      });

      const response = {
        intent: "ai_reasoning",
        period: "global",
        source_module: "ai_ceo",
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

      pushHistory({
        question,
        intent: response.intent,
        summary: response.summary,
        created_at: response.generated_at
      });

      return response;
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
