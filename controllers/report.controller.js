import { getCashForecast } from "../models/dashboard.model.js";
import { getMonthlyClosePack } from "../models/monthlyClose.model.js";
import {
  getBulkStockFlowComparison,
  getStockInvoiceBulkReconciliation
} from "../models/stock.model.js";
import {
  getBudgetVsActualReport,
  getBreakEvenReport,
  getCategorySalesReport,
  getCommissionDueReport,
  getCommercialSalesReport,
  getCollectionsReport,
  getCustomerAgingReport,
  getCustomerLedgerReport,
  getExpenseCategoryReport,
  getExpensesJournalReport,
  getIncomeStatementReport,
  getMarginByCityReport,
  getMarginByCustomerReport,
  getMarketingRatioReport,
  getProductLedgerReport,
  getProductSalesReport,
  getReceiptsJournalReport,
  getSupplierAgingReport,
  getSalesDetailReport,
  getTreasuryStatementReport,
  getStockStateReport
} from "../models/report.model.js";
import {
  buildExportFilename,
  createMonthlyClosePackPdfBuffer,
  createMonthlyClosePackXlsxBuffer,
  createCashForecastPdfBuffer,
  createCashForecastXlsxBuffer,
  createTabularReportPdfBuffer,
  createTabularReportXlsxBuffer,
  sendDownloadBuffer
} from "../services/reportExport.service.js";

function getTodayString() {
  return new Date().toISOString().split("T")[0];
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveIntegerList(value) {
  const rawValues = Array.isArray(value) ? value : [value];

  return [...new Set(
    rawValues
      .flatMap((item) => String(item ?? "").split(","))
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isInteger(item) && item > 0)
  )];
}

function parseYear(value, fallbackValue) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
    return fallbackValue;
  }

  return parsed;
}

function parseMonth(value, fallbackValue) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
    return fallbackValue;
  }

  return parsed;
}

function parsePositiveLimit(value, defaultValue = 200, maxValue = 5000) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function parseDateFilter(value, fallbackValue = null) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallbackValue;
  }

  const normalized = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  return normalized === "true" || normalized === "1" || normalized === "yes";
}

const reportDefinitions = {
  collections: {
    title: "Etat de recouvrement clients",
    subtitle:
      "Factures classees par statut de paiement et niveau d'alerte depuis leur emission",
    tableTitle: "Plan de recouvrement par facture",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `etat-recouvrement-${filters.as_of_date || getTodayString()}`,
    getPdfRowFillColor: (row) =>
      ({
        red: "#FEE2E2",
        orange: "#FFEDD5",
        light_green: "#ECFCCB",
        green: "#DCFCE7",
        paid: "#DBEAFE"
      })[row.alert_level] || null,
    columns: [
      { key: "alert_label", header: "Alerte", width: 94, xlsxWidth: 24 },
      {
        key: "collection_age_days",
        header: "Age",
        type: "integer",
        width: 34,
        xlsxWidth: 9
      },
      { key: "invoice_number", header: "Facture", width: 72, xlsxWidth: 17 },
      { key: "invoice_date", header: "Emission", type: "date", width: 56, xlsxWidth: 13 },
      { key: "customer_name", header: "Client", width: 130, xlsxWidth: 30 },
      { key: "payment_status_label", header: "Paiement", width: 70, xlsxWidth: 18 },
      { key: "total_amount", header: "Facture", type: "money", width: 62, xlsxWidth: 15 },
      { key: "paid_amount", header: "Paye", type: "money", width: 58, xlsxWidth: 15 },
      { key: "balance_due", header: "Solde", type: "money", width: 62, xlsxWidth: 15 }
    ],
    summaryItems: (summary) => [
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Montant facture",
        value: Number(summary.total_invoiced_amount || 0),
        rawValue: Number(summary.total_invoiced_amount || 0),
        type: "money"
      },
      {
        label: "Montant paye",
        value: Number(summary.total_paid_amount || 0),
        rawValue: Number(summary.total_paid_amount || 0),
        type: "money"
      },
      {
        label: "Solde a recouvrer",
        value: Number(summary.total_balance_due || 0),
        rawValue: Number(summary.total_balance_due || 0),
        type: "money"
      },
      {
        label: "Non payees",
        value: Number(summary.unpaid_invoices_count || 0),
        rawValue: Number(summary.unpaid_invoices_count || 0),
        type: "integer"
      },
      {
        label: "Partielles",
        value: Number(summary.partial_invoices_count || 0),
        rawValue: Number(summary.partial_invoices_count || 0),
        type: "integer"
      },
      {
        label: "Orange 30-44 j",
        value: Number(summary.orange_balance_amount || 0),
        rawValue: Number(summary.orange_balance_amount || 0),
        type: "money"
      },
      {
        label: "Rouge 45+ j",
        value: Number(summary.red_balance_amount || 0),
        rawValue: Number(summary.red_balance_amount || 0),
        type: "money"
      }
    ]
  },
  "customer-aging": {
    title: "Balance agee clients",
    subtitle: "Creances ouvertes par client et tranches d'age",
    tableTitle: "Creances clients",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `balance-agee-clients-${filters.as_of_date || getTodayString()}`,
    columns: [
      { key: "business_name", header: "Client", width: 110, xlsxWidth: 28 },
      { key: "city", header: "Ville", width: 55, xlsxWidth: 16 },
      {
        key: "open_invoices_count",
        header: "Fact.",
        type: "integer",
        width: 52,
        xlsxWidth: 10
      },
      {
        key: "oldest_due_date",
        header: "Anc. ech.",
        type: "date",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "total_balance_due",
        header: "Solde total",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "current_balance",
        header: "Non echu",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_1_30",
        header: "1-30 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_31_60",
        header: "31-60 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_61_90",
        header: "61-90 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_90_plus",
        header: "90+ j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Factures ouvertes",
        value: Number(summary.open_invoices_count || 0),
        rawValue: Number(summary.open_invoices_count || 0),
        type: "integer"
      },
      {
        label: "Solde total",
        value: Number(summary.total_balance_due || 0),
        rawValue: Number(summary.total_balance_due || 0),
        type: "money"
      },
      {
        label: "1-30 jours",
        value: Number(summary.bucket_1_30 || 0),
        rawValue: Number(summary.bucket_1_30 || 0),
        type: "money"
      },
      {
        label: "31-60 jours",
        value: Number(summary.bucket_31_60 || 0),
        rawValue: Number(summary.bucket_31_60 || 0),
        type: "money"
      },
      {
        label: "61-90 jours",
        value: Number(summary.bucket_61_90 || 0),
        rawValue: Number(summary.bucket_61_90 || 0),
        type: "money"
      },
      {
        label: "90+ jours",
        value: Number(summary.bucket_90_plus || 0),
        rawValue: Number(summary.bucket_90_plus || 0),
        type: "money"
      },
      {
        label: "Non date",
        value: Number(summary.undated_balance || 0),
        rawValue: Number(summary.undated_balance || 0),
        type: "money"
      }
    ]
  },
  "supplier-aging": {
    title: "Balance agee fournisseurs",
    subtitle: "Dettes ouvertes par fournisseur et tranches d'age",
    tableTitle: "Dettes fournisseurs",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `balance-agee-fournisseurs-${filters.as_of_date || getTodayString()}`,
    columns: [
      { key: "business_name", header: "Fournisseur", width: 110, xlsxWidth: 28 },
      { key: "city", header: "Ville", width: 55, xlsxWidth: 16 },
      {
        key: "open_invoices_count",
        header: "Fact.",
        type: "integer",
        width: 52,
        xlsxWidth: 10
      },
      {
        key: "oldest_due_date",
        header: "Anc. ech.",
        type: "date",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "total_balance_due",
        header: "Solde total",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "current_balance",
        header: "Non echu",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_1_30",
        header: "1-30 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_31_60",
        header: "31-60 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_61_90",
        header: "61-90 j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "bucket_90_plus",
        header: "90+ j",
        type: "money",
        width: 75,
        xlsxWidth: 16
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Fournisseurs",
        value: Number(summary.total_suppliers || 0),
        rawValue: Number(summary.total_suppliers || 0),
        type: "integer"
      },
      {
        label: "Factures ouvertes",
        value: Number(summary.open_invoices_count || 0),
        rawValue: Number(summary.open_invoices_count || 0),
        type: "integer"
      },
      {
        label: "Solde total",
        value: Number(summary.total_balance_due || 0),
        rawValue: Number(summary.total_balance_due || 0),
        type: "money"
      },
      {
        label: "1-30 jours",
        value: Number(summary.bucket_1_30 || 0),
        rawValue: Number(summary.bucket_1_30 || 0),
        type: "money"
      },
      {
        label: "31-60 jours",
        value: Number(summary.bucket_31_60 || 0),
        rawValue: Number(summary.bucket_31_60 || 0),
        type: "money"
      },
      {
        label: "61-90 jours",
        value: Number(summary.bucket_61_90 || 0),
        rawValue: Number(summary.bucket_61_90 || 0),
        type: "money"
      },
      {
        label: "90+ jours",
        value: Number(summary.bucket_90_plus || 0),
        rawValue: Number(summary.bucket_90_plus || 0),
        type: "money"
      },
      {
        label: "Non date",
        value: Number(summary.undated_balance || 0),
        rawValue: Number(summary.undated_balance || 0),
        type: "money"
      }
    ]
  },
  "customer-ledger": {
    title: "Compte courant clients",
    subtitle:
      "Vision bilan client avec le total facture, le total paye et la balance sur la periode choisie",
    tableTitle: "Compte courant clients",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `compte-courant-clients-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "business_name", header: "Client", width: 105, xlsxWidth: 28 },
      { key: "city", header: "Ville", width: 60, xlsxWidth: 16 },
      {
        key: "invoiced_amount",
        header: "Factures",
        type: "money",
        width: 80,
        xlsxWidth: 18
      },
      {
        key: "paid_amount",
        header: "Paiements",
        type: "money",
        width: 80,
        xlsxWidth: 18
      },
      {
        key: "balance_amount",
        header: "Balance",
        type: "money",
        width: 80,
        xlsxWidth: 18
      },
      {
        key: "invoices_count",
        header: "Nb fact.",
        type: "integer",
        width: 55,
        xlsxWidth: 12
      },
      {
        key: "payments_count",
        header: "Nb paiem.",
        type: "integer",
        width: 58,
        xlsxWidth: 12
      },
      {
        key: "last_invoice_date",
        header: "Dern. fact.",
        type: "date",
        width: 70,
        xlsxWidth: 16
      },
      {
        key: "last_payment_date",
        header: "Dern. paiem.",
        type: "date",
        width: 70,
        xlsxWidth: 16
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Nb factures",
        value: Number(summary.invoices_count || 0),
        rawValue: Number(summary.invoices_count || 0),
        type: "integer"
      },
      {
        label: "Nb paiements",
        value: Number(summary.payments_count || 0),
        rawValue: Number(summary.payments_count || 0),
        type: "integer"
      },
      {
        label: "Total factures",
        value: Number(summary.invoiced_amount || 0),
        rawValue: Number(summary.invoiced_amount || 0),
        type: "money"
      },
      {
        label: "Total paiements",
        value: Number(summary.paid_amount || 0),
        rawValue: Number(summary.paid_amount || 0),
        type: "money"
      },
      {
        label: "Balance",
        value: Number(summary.balance_amount || 0),
        rawValue: Number(summary.balance_amount || 0),
        type: "money"
      }
    ]
  },
  "sales-detail": {
    title: "Etat commercial detaille",
    subtitle: "Ventes facturees, couts et profit brut",
    tableTitle: "Lignes commerciales",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `etat-commercial-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "invoice_number", header: "Facture", width: 65, xlsxWidth: 16 },
      {
        key: "invoice_date",
        header: "Date",
        type: "date",
        width: 60,
        xlsxWidth: 14
      },
      { key: "customer_name", header: "Client", width: 95, xlsxWidth: 24 },
      { key: "warehouse_name", header: "Depot", width: 70, xlsxWidth: 18 },
      { key: "product_name", header: "Produit", width: 110, xlsxWidth: 28 },
      {
        key: "quantity",
        header: "Qte",
        type: "number",
        width: 45,
        xlsxWidth: 12
      },
      {
        key: "unit_price",
        header: "P.U.",
        type: "money",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "line_total",
        header: "CA",
        type: "money",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "line_cogs_amount",
        header: "Cout",
        type: "money",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "gross_profit_amount",
        header: "Profit",
        type: "money",
        width: 70,
        xlsxWidth: 14
      },
      {
        key: "gross_margin_percent",
        header: "Marge %",
        type: "number",
        width: 50,
        xlsxWidth: 12,
        value: (row) => Number(row.gross_margin_percent || 0)
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Lignes",
        value: Number(summary.total_lines || 0),
        rawValue: Number(summary.total_lines || 0),
        type: "integer"
      },
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Quantite",
        value: Number(summary.total_quantity || 0),
        rawValue: Number(summary.total_quantity || 0),
        type: "number"
      },
      {
        label: "Chiffre d'affaires",
        value: Number(summary.total_sales_amount || 0),
        rawValue: Number(summary.total_sales_amount || 0),
        type: "money"
      },
      {
        label: "Cout total",
        value: Number(summary.total_cogs_amount || 0),
        rawValue: Number(summary.total_cogs_amount || 0),
        type: "money"
      },
      {
        label: "Profit brut",
        value: Number(summary.gross_profit_amount || 0),
        rawValue: Number(summary.gross_profit_amount || 0),
        type: "money"
      },
      {
        label: "Marge %",
        value: Number(summary.gross_margin_percent || 0),
        rawValue: Number(summary.gross_margin_percent || 0),
        type: "number"
      }
    ]
  },
  "product-ledger": {
    title: "Compte courant produits",
    subtitle:
      "Lignes facturees par produit, client, depot et facture, avec lecture quantite, chiffre d'affaires et profit",
    tableTitle: "Compte courant produits",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `compte-courant-produits-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "invoice_number", header: "Facture", width: 62, xlsxWidth: 16 },
      {
        key: "invoice_date",
        header: "Date",
        type: "date",
        width: 56,
        xlsxWidth: 14
      },
      { key: "product_name", header: "Produit", width: 95, xlsxWidth: 24 },
      { key: "customer_name", header: "Client", width: 82, xlsxWidth: 20 },
      { key: "warehouse_name", header: "Depot", width: 64, xlsxWidth: 16 },
      {
        key: "quantity",
        header: "Qte",
        type: "number",
        width: 40,
        xlsxWidth: 10
      },
      {
        key: "unit_price",
        header: "P.U.",
        type: "money",
        width: 58,
        xlsxWidth: 14
      },
      {
        key: "line_total",
        header: "CA",
        type: "money",
        width: 62,
        xlsxWidth: 15
      },
      {
        key: "gross_profit_amount",
        header: "Profit",
        type: "money",
        width: 62,
        xlsxWidth: 15
      },
      {
        key: "invoice_paid_amount",
        header: "Paye",
        type: "money",
        width: 60,
        xlsxWidth: 15
      },
      {
        key: "invoice_balance_due",
        header: "Solde",
        type: "money",
        width: 60,
        xlsxWidth: 15
      },
      {
        key: "invoice_status",
        header: "Statut",
        width: 46,
        xlsxWidth: 12
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Lignes",
        value: Number(summary.total_lines || 0),
        rawValue: Number(summary.total_lines || 0),
        type: "integer"
      },
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Produits",
        value: Number(summary.total_products || 0),
        rawValue: Number(summary.total_products || 0),
        type: "integer"
      },
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Depots",
        value: Number(summary.total_warehouses || 0),
        rawValue: Number(summary.total_warehouses || 0),
        type: "integer"
      },
      {
        label: "Quantite vendue",
        value: Number(summary.total_quantity || 0),
        rawValue: Number(summary.total_quantity || 0),
        type: "number"
      },
      {
        label: "Chiffre d'affaires",
        value: Number(summary.total_sales_amount || 0),
        rawValue: Number(summary.total_sales_amount || 0),
        type: "money"
      },
      {
        label: "Profit brut",
        value: Number(summary.gross_profit_amount || 0),
        rawValue: Number(summary.gross_profit_amount || 0),
        type: "money"
      },
      {
        label: "Paye facture",
        value: Number(summary.total_paid_amount || 0),
        rawValue: Number(summary.total_paid_amount || 0),
        type: "money"
      },
      {
        label: "Solde facture",
        value: Number(summary.total_balance_due || 0),
        rawValue: Number(summary.total_balance_due || 0),
        type: "money"
      }
    ]
  },
  "product-sales": {
    title: "Analyse ventes par produit",
    subtitle: "Analyse quantitative et financiere par produit, depot et client",
    tableTitle: "Synthese ventes produit",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `ventes-produit-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "product_name", header: "Produit", width: 95, xlsxWidth: 24 },
      { key: "sku", header: "SKU", width: 55, xlsxWidth: 14 },
      {
        key: "category",
        header: "Categorie",
        width: 65,
        xlsxWidth: 16
      },
      {
        key: "warehouse_name",
        header: "Depot",
        width: 70,
        xlsxWidth: 18
      },
      {
        key: "customer_name",
        header: "Client",
        width: 80,
        xlsxWidth: 20
      },
      {
        key: "invoices_count",
        header: "Fact.",
        type: "integer",
        width: 45,
        xlsxWidth: 10
      },
      {
        key: "total_quantity",
        header: "Qte",
        type: "number",
        width: 50,
        xlsxWidth: 12
      },
      {
        key: "total_sales_amount",
        header: "CA",
        type: "money",
        width: 70,
        xlsxWidth: 16
      },
      {
        key: "gross_profit_amount",
        header: "Profit",
        type: "money",
        width: 70,
        xlsxWidth: 16
      },
      {
        key: "first_invoice_date",
        header: "Prem. vente",
        type: "date",
        width: 60,
        xlsxWidth: 14
      },
      {
        key: "last_invoice_date",
        header: "Dern. vente",
        type: "date",
        width: 60,
        xlsxWidth: 14
      },
      {
        key: "gross_margin_percent",
        header: "Marge %",
        type: "number",
        width: 55,
        xlsxWidth: 12,
        value: (row) => Number(row.gross_margin_percent || 0)
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Regroupements",
        value: Number(summary.total_rows || 0),
        rawValue: Number(summary.total_rows || 0),
        type: "integer"
      },
      {
        label: "Produits",
        value: Number(summary.total_products || 0),
        rawValue: Number(summary.total_products || 0),
        type: "integer"
      },
      {
        label: "Depots",
        value: Number(summary.total_warehouses || 0),
        rawValue: Number(summary.total_warehouses || 0),
        type: "integer"
      },
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Quantite",
        value: Number(summary.total_quantity || 0),
        rawValue: Number(summary.total_quantity || 0),
        type: "number"
      },
      {
        label: "Chiffre d'affaires",
        value: Number(summary.total_sales_amount || 0),
        rawValue: Number(summary.total_sales_amount || 0),
        type: "money"
      },
      {
        label: "Profit brut",
        value: Number(summary.gross_profit_amount || 0),
        rawValue: Number(summary.gross_profit_amount || 0),
        type: "money"
      },
      {
        label: "Marge %",
        value: Number(summary.gross_margin_percent || 0),
        rawValue: Number(summary.gross_margin_percent || 0),
        type: "number"
      }
    ]
  },
  "sales-by-category": {
    title: "Ventes par categorie",
    subtitle:
      "Etat commercial synthetique par categorie avec volume, chiffre d'affaires, cout, profit et marge",
    tableTitle: "Synthese ventes par categorie",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `ventes-par-categorie-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "category_label", header: "Categorie", width: 120, xlsxWidth: 28 },
      {
        key: "products_count",
        header: "Prod.",
        type: "integer",
        width: 50,
        xlsxWidth: 10
      },
      {
        key: "customers_count",
        header: "Clients",
        type: "integer",
        width: 55,
        xlsxWidth: 10
      },
      {
        key: "warehouses_count",
        header: "Depots",
        type: "integer",
        width: 52,
        xlsxWidth: 10
      },
      {
        key: "invoices_count",
        header: "Fact.",
        type: "integer",
        width: 50,
        xlsxWidth: 10
      },
      {
        key: "total_quantity",
        header: "Qte",
        type: "number",
        width: 58,
        xlsxWidth: 12
      },
      {
        key: "total_sales_amount",
        header: "CA",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "total_cogs_amount",
        header: "Cout",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "gross_profit_amount",
        header: "Profit",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "gross_margin_percent",
        header: "Marge %",
        type: "number",
        width: 58,
        xlsxWidth: 12,
        value: (row) => Number(row.gross_margin_percent || 0)
      },
      {
        key: "first_invoice_date",
        header: "Prem. vente",
        type: "date",
        width: 68,
        xlsxWidth: 14
      },
      {
        key: "last_invoice_date",
        header: "Dern. vente",
        type: "date",
        width: 68,
        xlsxWidth: 14
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Categories",
        value: Number(summary.total_categories || 0),
        rawValue: Number(summary.total_categories || 0),
        type: "integer"
      },
      {
        label: "Produits",
        value: Number(summary.total_products || 0),
        rawValue: Number(summary.total_products || 0),
        type: "integer"
      },
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Depots",
        value: Number(summary.total_warehouses || 0),
        rawValue: Number(summary.total_warehouses || 0),
        type: "integer"
      },
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Quantite",
        value: Number(summary.total_quantity || 0),
        rawValue: Number(summary.total_quantity || 0),
        type: "number"
      },
      {
        label: "Chiffre d'affaires",
        value: Number(summary.total_sales_amount || 0),
        rawValue: Number(summary.total_sales_amount || 0),
        type: "money"
      },
      {
        label: "Profit brut",
        value: Number(summary.gross_profit_amount || 0),
        rawValue: Number(summary.gross_profit_amount || 0),
        type: "money"
      },
      {
        label: "Marge %",
        value: Number(summary.gross_margin_percent || 0),
        rawValue: Number(summary.gross_margin_percent || 0),
        type: "number"
      }
    ]
  },
  "sales-by-commercial": {
    title: "Ventes par commercial",
    subtitle:
      "Etat commercial par responsable avec chiffre d'affaires, recouvrement, encours et profit",
    tableTitle: "Synthese ventes par commercial",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `ventes-par-commercial-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "commercial_name", header: "Commercial", width: 95, xlsxWidth: 24 },
      {
        key: "commercial_source",
        header: "Source",
        width: 70,
        xlsxWidth: 14,
        value: (row) =>
          row.commercial_source === "client"
            ? "Client"
            : row.commercial_source === "depot_manager"
            ? "Depot"
            : "A completer"
      },
      {
        key: "customers_count",
        header: "Clients",
        type: "integer",
        width: 50,
        xlsxWidth: 10
      },
      {
        key: "cities_count",
        header: "Villes",
        type: "integer",
        width: 46,
        xlsxWidth: 10
      },
      {
        key: "chains_count",
        header: "Chaines",
        type: "integer",
        width: 50,
        xlsxWidth: 10
      },
      {
        key: "warehouses_count",
        header: "Depots",
        type: "integer",
        width: 48,
        xlsxWidth: 10
      },
      {
        key: "invoices_count",
        header: "Fact.",
        type: "integer",
        width: 46,
        xlsxWidth: 10
      },
      {
        key: "total_quantity",
        header: "Qte",
        type: "number",
        width: 52,
        xlsxWidth: 12
      },
      {
        key: "total_sales_amount",
        header: "CA",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "total_collected_amount",
        header: "Encaisse",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "total_receivables",
        header: "Encours",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "gross_profit_amount",
        header: "Profit",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "collection_rate_percent",
        header: "Recouv. %",
        type: "number",
        width: 58,
        xlsxWidth: 12,
        value: (row) => Number(row.collection_rate_percent || 0)
      },
      {
        key: "gross_margin_percent",
        header: "Marge %",
        type: "number",
        width: 58,
        xlsxWidth: 12,
        value: (row) => Number(row.gross_margin_percent || 0)
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Commerciaux",
        value: Number(summary.total_commercials || 0),
        rawValue: Number(summary.total_commercials || 0),
        type: "integer"
      },
      {
        label: "Clients",
        value: Number(summary.total_customers || 0),
        rawValue: Number(summary.total_customers || 0),
        type: "integer"
      },
      {
        label: "Villes",
        value: Number(summary.total_cities || 0),
        rawValue: Number(summary.total_cities || 0),
        type: "integer"
      },
      {
        label: "Depots",
        value: Number(summary.total_warehouses || 0),
        rawValue: Number(summary.total_warehouses || 0),
        type: "integer"
      },
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Chiffre d'affaires",
        value: Number(summary.total_sales_amount || 0),
        rawValue: Number(summary.total_sales_amount || 0),
        type: "money"
      },
      {
        label: "Encaissements",
        value: Number(summary.total_collected_amount || 0),
        rawValue: Number(summary.total_collected_amount || 0),
        type: "money"
      },
      {
        label: "Encours",
        value: Number(summary.total_receivables || 0),
        rawValue: Number(summary.total_receivables || 0),
        type: "money"
      },
      {
        label: "Profit brut",
        value: Number(summary.gross_profit_amount || 0),
        rawValue: Number(summary.gross_profit_amount || 0),
        type: "money"
      }
    ]
  },
  "break-even": {
    title: "Seuil de rentabilite",
    subtitle:
      "Lecture du point mort a partir des ventes observees, des couts variables directs et des charges d'exploitation",
    tableTitle: "Evolution mensuelle du seuil de rentabilite",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `seuil-rentabilite-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "period_label", header: "Periode", width: 78, xlsxWidth: 16 },
      {
        key: "invoices_count",
        header: "Fact.",
        type: "integer",
        width: 45,
        xlsxWidth: 10
      },
      {
        key: "expenses_count",
        header: "Dep.",
        type: "integer",
        width: 42,
        xlsxWidth: 10
      },
      {
        key: "total_quantity",
        header: "Qte",
        type: "number",
        width: 52,
        xlsxWidth: 12
      },
      {
        key: "net_sales_amount",
        header: "CA net",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "variable_cost_amount",
        header: "Cout var.",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "contribution_margin_amount",
        header: "Marge contrib.",
        type: "money",
        width: 78,
        xlsxWidth: 18
      },
      {
        key: "contribution_margin_ratio",
        header: "Tx contrib. %",
        type: "number",
        width: 62,
        xlsxWidth: 12,
        value: (row) => Number(row.contribution_margin_ratio || 0)
      },
      {
        key: "operating_expenses_amount",
        header: "Charges",
        type: "money",
        width: 72,
        xlsxWidth: 16
      },
      {
        key: "break_even_sales_amount",
        header: "Point mort CA",
        type: "money",
        width: 78,
        xlsxWidth: 18
      },
      {
        key: "safety_margin_amount",
        header: "Marge secu.",
        type: "money",
        width: 78,
        xlsxWidth: 18
      },
      {
        key: "safety_margin_percent",
        header: "Secu. %",
        type: "number",
        width: 55,
        xlsxWidth: 12,
        value: (row) => Number(row.safety_margin_percent || 0)
      },
      {
        key: "status",
        header: "Statut",
        width: 62,
        xlsxWidth: 12,
        value: (row) =>
          row.status === "au-dessus"
            ? "Au-dessus"
            : row.status === "en-dessous"
            ? "En-dessous"
            : "Indetermine"
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Factures",
        value: Number(summary.total_invoices || 0),
        rawValue: Number(summary.total_invoices || 0),
        type: "integer"
      },
      {
        label: "Depenses",
        value: Number(summary.total_expenses || 0),
        rawValue: Number(summary.total_expenses || 0),
        type: "integer"
      },
      {
        label: "Quantite vendue",
        value: Number(summary.total_quantity || 0),
        rawValue: Number(summary.total_quantity || 0),
        type: "number"
      },
      {
        label: "CA net",
        value: Number(summary.net_sales_amount || 0),
        rawValue: Number(summary.net_sales_amount || 0),
        type: "money"
      },
      {
        label: "Cout variable",
        value: Number(summary.variable_cost_amount || 0),
        rawValue: Number(summary.variable_cost_amount || 0),
        type: "money"
      },
      {
        label: "Marge sur cout variable",
        value: Number(summary.contribution_margin_amount || 0),
        rawValue: Number(summary.contribution_margin_amount || 0),
        type: "money"
      },
      {
        label: "Taux de contribution",
        value: Number(summary.contribution_margin_ratio || 0),
        rawValue: Number(summary.contribution_margin_ratio || 0),
        type: "number"
      },
      {
        label: "Charges d'exploitation",
        value: Number(summary.operating_expenses_amount || 0),
        rawValue: Number(summary.operating_expenses_amount || 0),
        type: "money"
      },
      {
        label: "Point mort CA",
        value: summary.break_even_sales_amount,
        rawValue: summary.break_even_sales_amount,
        type: "money"
      },
      {
        label: "Point mort unites",
        value: summary.break_even_units,
        rawValue: summary.break_even_units,
        type: "number"
      },
      {
        label: "Marge de securite",
        value: summary.safety_margin_amount,
        rawValue: summary.safety_margin_amount,
        type: "money"
      },
      {
        label: "Securite %",
        value: summary.safety_margin_percent,
        rawValue: summary.safety_margin_percent,
        type: "number"
      }
    ]
  },
  "income-statement": {
    title: "Compte de resultat",
    subtitle: "Produits, charges, benefice brut et resultat net",
    tableTitle: "Lignes du compte de resultat",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `compte-resultat-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "section", header: "Rubrique", width: 85, xlsxWidth: 22 },
      { key: "account_number", header: "Compte", width: 55, xlsxWidth: 14 },
      { key: "account_name", header: "Designation", width: 145, xlsxWidth: 36 },
      { key: "account_type", header: "Nature", width: 60, xlsxWidth: 14 },
      { key: "total_debit", header: "Debit", type: "money", width: 70, xlsxWidth: 16 },
      { key: "total_credit", header: "Credit", type: "money", width: 70, xlsxWidth: 16 },
      { key: "net_amount", header: "Net", type: "money", width: 75, xlsxWidth: 16 }
    ],
    summaryItems: (summary) => [
      { label: "Produits", value: Number(summary.total_revenue || 0), rawValue: Number(summary.total_revenue || 0), type: "money" },
      { label: "Charges", value: Number(summary.total_expense || 0), rawValue: Number(summary.total_expense || 0), type: "money" },
      { label: "Resultat net", value: Number(summary.net_result || 0), rawValue: Number(summary.net_result || 0), type: "money" },
      { label: "Ventes nettes", value: Number(summary.net_sales_amount || 0), rawValue: Number(summary.net_sales_amount || 0), type: "money" },
      { label: "COGS", value: Number(summary.total_cogs_amount || 0), rawValue: Number(summary.total_cogs_amount || 0), type: "money" },
      { label: "Benefice brut", value: Number(summary.gross_profit_amount || 0), rawValue: Number(summary.gross_profit_amount || 0), type: "money" },
      { label: "Marge brute %", value: Number(summary.gross_margin_percent || 0), rawValue: Number(summary.gross_margin_percent || 0), type: "number" }
    ]
  },
  "treasury-statement": {
    title: "Etat de tresorerie",
    subtitle: "Encaissements, decaissements et flux nets par periode",
    tableTitle: "Mouvements de tresorerie",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `etat-tresorerie-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "movement_date", header: "Date", type: "date", width: 58, xlsxWidth: 14 },
      { key: "flow_type", header: "Nature", width: 75, xlsxWidth: 20 },
      { key: "designation", header: "Designation", width: 125, xlsxWidth: 34 },
      { key: "third_party", header: "Client / fournisseur", width: 100, xlsxWidth: 28 },
      { key: "warehouse_name", header: "Depot", width: 75, xlsxWidth: 18 },
      { key: "document_reference", header: "Piece", width: 75, xlsxWidth: 18 },
      { key: "payment_method", header: "Mode", width: 55, xlsxWidth: 14 },
      { key: "inflow", header: "Entree", type: "money", width: 70, xlsxWidth: 16 },
      { key: "outflow", header: "Sortie", type: "money", width: 70, xlsxWidth: 16 },
      { key: "net_amount", header: "Flux net", type: "money", width: 70, xlsxWidth: 16 },
      { key: "running_balance", header: "Solde cumule", type: "money", width: 75, xlsxWidth: 18 }
    ],
    summaryItems: (summary) => [
      { label: "Mouvements", value: Number(summary.movements_count || 0), rawValue: Number(summary.movements_count || 0), type: "integer" },
      { label: "Encaissements", value: Number(summary.total_receipts || 0), rawValue: Number(summary.total_receipts || 0), type: "money" },
      { label: "Paiements fournisseurs", value: Number(summary.total_supplier_payments || 0), rawValue: Number(summary.total_supplier_payments || 0), type: "money" },
      { label: "Depenses", value: Number(summary.total_operating_expenses || 0), rawValue: Number(summary.total_operating_expenses || 0), type: "money" },
      { label: "Flux net", value: Number(summary.net_cash_flow || 0), rawValue: Number(summary.net_cash_flow || 0), type: "money" },
      { label: "Caisse", value: Number(summary.cash_on_hand_base || 0), rawValue: Number(summary.cash_on_hand_base || 0), type: "money" },
      { label: "Banque", value: Number(summary.bank_base || 0), rawValue: Number(summary.bank_base || 0), type: "money" },
      { label: "Mobile money", value: Number(summary.mobile_money_base || 0), rawValue: Number(summary.mobile_money_base || 0), type: "money" },
      { label: "Tresorerie observee", value: Number(summary.current_cash_base || 0), rawValue: Number(summary.current_cash_base || 0), type: "money" }
    ]
  },
  "receipts-journal": {
    title: "Journal des recettes",
    subtitle: "Historique des paiements clients encaisses",
    tableTitle: "Paiements clients",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `journal-recettes-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "payment_date", header: "Date", type: "date", width: 60, xlsxWidth: 14 },
      { key: "customer_name", header: "Client", width: 110, xlsxWidth: 26 },
      { key: "warehouse_name", header: "Depot", width: 80, xlsxWidth: 18 },
      { key: "invoice_number", header: "Facture", width: 75, xlsxWidth: 16 },
      { key: "payment_method", header: "Mode", width: 55, xlsxWidth: 12 },
      { key: "amount", header: "Montant", type: "money", width: 72, xlsxWidth: 16 },
      { key: "reference", header: "Reference", width: 85, xlsxWidth: 18 },
      { key: "accounting_status", header: "Compta", width: 55, xlsxWidth: 12 }
    ],
    summaryItems: (summary) => [
      { label: "Paiements", value: Number(summary.total_payments || 0), rawValue: Number(summary.total_payments || 0), type: "integer" },
      { label: "Clients", value: Number(summary.total_customers || 0), rawValue: Number(summary.total_customers || 0), type: "integer" },
      { label: "Depots", value: Number(summary.total_warehouses || 0), rawValue: Number(summary.total_warehouses || 0), type: "integer" },
      { label: "Total encaisse", value: Number(summary.total_amount || 0), rawValue: Number(summary.total_amount || 0), type: "money" }
    ]
  },
  "expenses-journal": {
    title: "Journal des depenses",
    subtitle: "Depenses enregistrees avec categories et comptabilisation",
    tableTitle: "Depenses",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `journal-depenses-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "expense_date", header: "Date", type: "date", width: 60, xlsxWidth: 14 },
      { key: "category", header: "Categorie", width: 90, xlsxWidth: 18 },
      { key: "description", header: "Description", width: 115, xlsxWidth: 28 },
      { key: "supplier_name", header: "Fournisseur", width: 95, xlsxWidth: 22 },
      { key: "payment_method", header: "Mode", width: 55, xlsxWidth: 12 },
      { key: "amount", header: "Montant", type: "money", width: 72, xlsxWidth: 16 },
      { key: "reference", header: "Reference", width: 80, xlsxWidth: 18 },
      { key: "accounting_status", header: "Compta", width: 55, xlsxWidth: 12 }
    ],
    summaryItems: (summary) => [
      { label: "Depenses", value: Number(summary.total_expenses || 0), rawValue: Number(summary.total_expenses || 0), type: "integer" },
      { label: "Categories", value: Number(summary.total_categories || 0), rawValue: Number(summary.total_categories || 0), type: "integer" },
      { label: "Montant total", value: Number(summary.total_amount || 0), rawValue: Number(summary.total_amount || 0), type: "money" },
      { label: "Depenses poste(es)", value: Number(summary.posted_count || 0), rawValue: Number(summary.posted_count || 0), type: "integer" }
    ]
  },
  "expenses-by-category": {
    title: "Depenses par categorie",
    subtitle: "Analyse des charges par poste de depense",
    tableTitle: "Categories de depenses",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `depenses-par-categorie-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "category_label", header: "Categorie", width: 105, xlsxWidth: 22 },
      { key: "expenses_count", header: "Lignes", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "methods_count", header: "Modes", type: "integer", width: 45, xlsxWidth: 10 },
      { key: "suppliers_count", header: "Fourn.", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "average_amount", header: "Panier moy.", type: "money", width: 72, xlsxWidth: 16 },
      { key: "total_amount", header: "Montant", type: "money", width: 75, xlsxWidth: 16 },
      { key: "first_expense_date", header: "Premiere", type: "date", width: 60, xlsxWidth: 14 },
      { key: "last_expense_date", header: "Derniere", type: "date", width: 60, xlsxWidth: 14 }
    ],
    summaryItems: (summary) => [
      { label: "Categories", value: Number(summary.total_categories || 0), rawValue: Number(summary.total_categories || 0), type: "integer" },
      { label: "Depenses", value: Number(summary.total_expenses || 0), rawValue: Number(summary.total_expenses || 0), type: "integer" },
      { label: "Montant total", value: Number(summary.total_amount || 0), rawValue: Number(summary.total_amount || 0), type: "money" },
      { label: "Marketing", value: Number(summary.marketing_amount || 0), rawValue: Number(summary.marketing_amount || 0), type: "money" }
    ]
  },
  "margin-by-city": {
    title: "Marge par ville",
    subtitle: "Rentabilite commerciale par ville cliente",
    tableTitle: "Villes clientes",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `marge-par-ville-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "customer_city", header: "Ville", width: 90, xlsxWidth: 20 },
      { key: "customers_count", header: "Clients", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "warehouses_count", header: "Depots", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "invoices_count", header: "Fact.", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "total_quantity", header: "Qte", type: "number", width: 55, xlsxWidth: 12 },
      { key: "total_sales_amount", header: "CA", type: "money", width: 72, xlsxWidth: 16 },
      { key: "gross_profit_amount", header: "Profit brut", type: "money", width: 75, xlsxWidth: 16 },
      { key: "gross_margin_percent", header: "Marge %", type: "number", width: 55, xlsxWidth: 12 },
      { key: "total_collected_amount", header: "Encaisse", type: "money", width: 72, xlsxWidth: 16 },
      { key: "collection_rate_percent", header: "Recouvr. %", type: "number", width: 58, xlsxWidth: 12 }
    ],
    summaryItems: (summary) => [
      { label: "Villes", value: Number(summary.total_cities || 0), rawValue: Number(summary.total_cities || 0), type: "integer" },
      { label: "CA", value: Number(summary.total_sales_amount || 0), rawValue: Number(summary.total_sales_amount || 0), type: "money" },
      { label: "Profit brut", value: Number(summary.gross_profit_amount || 0), rawValue: Number(summary.gross_profit_amount || 0), type: "money" },
      { label: "Marge %", value: Number(summary.gross_margin_percent || 0), rawValue: Number(summary.gross_margin_percent || 0), type: "number" },
      { label: "Encaisse", value: Number(summary.total_collected_amount || 0), rawValue: Number(summary.total_collected_amount || 0), type: "money" },
      { label: "Creances", value: Number(summary.total_receivables || 0), rawValue: Number(summary.total_receivables || 0), type: "money" }
    ]
  },
  "margin-by-customer": {
    title: "Marge par client",
    subtitle: "Rentabilite et recouvrement par client",
    tableTitle: "Clients",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `marge-par-client-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "customer_name", header: "Client", width: 110, xlsxWidth: 26 },
      { key: "customer_city", header: "Ville", width: 70, xlsxWidth: 16 },
      { key: "warehouses_count", header: "Depots", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "invoices_count", header: "Fact.", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "total_quantity", header: "Qte", type: "number", width: 55, xlsxWidth: 12 },
      { key: "total_sales_amount", header: "CA", type: "money", width: 72, xlsxWidth: 16 },
      { key: "gross_profit_amount", header: "Profit brut", type: "money", width: 75, xlsxWidth: 16 },
      { key: "gross_margin_percent", header: "Marge %", type: "number", width: 55, xlsxWidth: 12 },
      { key: "total_collected_amount", header: "Encaisse", type: "money", width: 72, xlsxWidth: 16 },
      { key: "collection_rate_percent", header: "Recouvr. %", type: "number", width: 58, xlsxWidth: 12 }
    ],
    summaryItems: (summary) => [
      { label: "Clients", value: Number(summary.total_customers || 0), rawValue: Number(summary.total_customers || 0), type: "integer" },
      { label: "CA", value: Number(summary.total_sales_amount || 0), rawValue: Number(summary.total_sales_amount || 0), type: "money" },
      { label: "Profit brut", value: Number(summary.gross_profit_amount || 0), rawValue: Number(summary.gross_profit_amount || 0), type: "money" },
      { label: "Marge %", value: Number(summary.gross_margin_percent || 0), rawValue: Number(summary.gross_margin_percent || 0), type: "number" },
      { label: "Encaisse", value: Number(summary.total_collected_amount || 0), rawValue: Number(summary.total_collected_amount || 0), type: "money" },
      { label: "Creances", value: Number(summary.total_receivables || 0), rawValue: Number(summary.total_receivables || 0), type: "money" }
    ]
  },
  "budget-vs-actual": {
    title: "Budget vs realise",
    subtitle: "Comparaison budgetaire par categorie",
    tableTitle: "Ecarts budgetaires",
    pdfLayout: "landscape",
    buildFilename: (filters) => `budget-vs-realise-${filters.budget_id || "auto"}`,
    columns: [
      { key: "category_label", header: "Categorie", width: 110, xlsxWidth: 28 },
      { key: "category_type", header: "Type", width: 60, xlsxWidth: 14 },
      { key: "planned_total", header: "Budget", type: "money", width: 75, xlsxWidth: 16 },
      { key: "actual_total", header: "Realise", type: "money", width: 75, xlsxWidth: 16 },
      { key: "variance_total", header: "Ecart", type: "money", width: 75, xlsxWidth: 16 },
      { key: "attainment_percent", header: "Atteinte %", type: "number", width: 60, xlsxWidth: 14 }
    ],
    summaryItems: (summary) => [
      { label: "Budget", value: Number(summary.total_planned || 0), rawValue: Number(summary.total_planned || 0), type: "money" },
      { label: "Realise", value: Number(summary.total_actual || 0), rawValue: Number(summary.total_actual || 0), type: "money" },
      { label: "Ecart", value: Number(summary.total_variance || 0), rawValue: Number(summary.total_variance || 0), type: "money" },
      { label: "Atteinte %", value: Number(summary.attainment_percent || 0), rawValue: Number(summary.attainment_percent || 0), type: "number" }
    ]
  },
  "marketing-ratio": {
    title: "Marketing sur chiffre d'affaires",
    subtitle: "Poids des depenses marketing dans le chiffre d'affaires",
    tableTitle: "Marketing vs ventes",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `marketing-sur-ca-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "period_label", header: "Periode", width: 75, xlsxWidth: 18 },
      { key: "total_sales_amount", header: "CA", type: "money", width: 80, xlsxWidth: 16 },
      { key: "marketing_expenses_amount", header: "Depenses marketing", type: "money", width: 85, xlsxWidth: 18 },
      { key: "marketing_ratio_percent", header: "Marketing % CA", type: "number", width: 70, xlsxWidth: 14 }
    ],
    summaryItems: (summary) => [
      { label: "CA", value: Number(summary.total_sales_amount || 0), rawValue: Number(summary.total_sales_amount || 0), type: "money" },
      { label: "Marketing", value: Number(summary.marketing_expenses_amount || 0), rawValue: Number(summary.marketing_expenses_amount || 0), type: "money" },
      { label: "Marketing % CA", value: Number(summary.marketing_ratio_percent || 0), rawValue: Number(summary.marketing_ratio_percent || 0), type: "number" }
    ]
  },
  "commission-due": {
    title: "Commissions dues",
    subtitle: "Commissions calculees sur les montants reellement encaisses",
    tableTitle: "Beneficiaires des commissions",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `commissions-dues-${filters.start_date || "debut"}-${filters.end_date || "fin"}`,
    columns: [
      { key: "beneficiary_type", header: "Type", width: 60, xlsxWidth: 14 },
      { key: "beneficiary_name", header: "Beneficiaire", width: 115, xlsxWidth: 28 },
      { key: "customers_count", header: "Clients", type: "integer", width: 45, xlsxWidth: 10 },
      { key: "invoices_count", header: "Fact.", type: "integer", width: 45, xlsxWidth: 10 },
      { key: "payments_count", header: "Paiem.", type: "integer", width: 48, xlsxWidth: 10 },
      { key: "collections_amount", header: "Encaisse", type: "money", width: 75, xlsxWidth: 16 },
      { key: "commission_rate_percent", header: "Taux %", type: "number", width: 50, xlsxWidth: 12 },
      { key: "commission_due_amount", header: "Commission", type: "money", width: 75, xlsxWidth: 16 },
      { key: "profile_configured", header: "Profil", type: "boolean", width: 48, xlsxWidth: 10 }
    ],
    summaryItems: (summary) => [
      { label: "Beneficiaires", value: Number(summary.total_beneficiaries || 0), rawValue: Number(summary.total_beneficiaries || 0), type: "integer" },
      { label: "Encaisse base", value: Number(summary.total_collections_amount || 0), rawValue: Number(summary.total_collections_amount || 0), type: "money" },
      { label: "Commission due", value: Number(summary.total_commission_due_amount || 0), rawValue: Number(summary.total_commission_due_amount || 0), type: "money" },
      { label: "Profils configures", value: Number(summary.configured_profiles_count || 0), rawValue: Number(summary.configured_profiles_count || 0), type: "integer" }
    ]
  },
  "stock-state": {
    title: "Etat de stock",
    subtitle: "Stock par depot, seuils d'alerte et valorisation",
    tableTitle: "Situation de stock",
    pdfLayout: "landscape",
    buildFilename: () => "etat-stock",
    columns: [
      { key: "warehouse_name", header: "Depot", width: 70, xlsxWidth: 18 },
      { key: "warehouse_city", header: "Ville", width: 55, xlsxWidth: 16 },
      { key: "product_name", header: "Produit", width: 110, xlsxWidth: 28 },
      { key: "category", header: "Categorie", width: 70, xlsxWidth: 18 },
      {
        key: "quantity",
        header: "Stock",
        type: "number",
        width: 55,
        xlsxWidth: 12
      },
      { key: "unit", header: "Unite", width: 45, xlsxWidth: 10 },
      {
        key: "alert_threshold",
        header: "Seuil",
        type: "number",
        width: 55,
        xlsxWidth: 12
      },
      {
        key: "unit_cost",
        header: "Cout unit.",
        type: "money",
        width: 65,
        xlsxWidth: 14
      },
      {
        key: "stock_value",
        header: "Valeur",
        type: "money",
        width: 75,
        xlsxWidth: 16
      },
      {
        key: "is_below_alert",
        header: "Sous seuil",
        type: "boolean",
        width: 55,
        xlsxWidth: 12
      }
    ],
    summaryItems: (summary) => [
      {
        label: "Lignes",
        value: Number(summary.total_rows || 0),
        rawValue: Number(summary.total_rows || 0),
        type: "integer"
      },
      {
        label: "Unites totales",
        value: Number(summary.total_units || 0),
        rawValue: Number(summary.total_units || 0),
        type: "number"
      },
      {
        label: "Valeur stock",
        value: Number(summary.total_stock_value || 0),
        rawValue: Number(summary.total_stock_value || 0),
        type: "money"
      },
      {
        label: "Lignes sous seuil",
        value: Number(summary.low_stock_rows || 0),
        rawValue: Number(summary.low_stock_rows || 0),
        type: "integer"
      },
      {
        label: "Unites sous seuil",
        value: Number(summary.low_stock_units || 0),
        rawValue: Number(summary.low_stock_units || 0),
        type: "number"
      }
    ]
  },
  "bulk-stock-flow": {
    title: "Stock theorique en vrac",
    subtitle:
      "Entrees en vrac moins consommation calculee sur les produits finis factures",
    tableTitle: "Reste theorique par depot et article",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `stock-vrac-${filters.start_date || "debut"}-${
        filters.end_date || getTodayString()
      }`,
    columns: [
      { key: "warehouse_name", header: "Depot", width: 72, xlsxWidth: 18 },
      { key: "product_name", header: "Article vrac", width: 105, xlsxWidth: 28 },
      { key: "sku", header: "SKU", width: 52, xlsxWidth: 14 },
      { key: "reporting_unit", header: "Unite", width: 42, xlsxWidth: 10 },
      { key: "opening_stock", header: "Ouverture", type: "number", width: 58, xlsxWidth: 14 },
      { key: "bulk_entries", header: "Entrees", type: "number", width: 58, xlsxWidth: 14 },
      { key: "transfer_in", header: "Transf. +", type: "number", width: 58, xlsxWidth: 14 },
      { key: "transfer_out", header: "Transf. -", type: "number", width: 58, xlsxWidth: 14 },
      { key: "invoice_consumption", header: "Conso. factures", type: "number", width: 70, xlsxWidth: 16 },
      { key: "total_consumption", header: "Conso. totale", type: "number", width: 66, xlsxWidth: 16 },
      { key: "theoretical_remaining", header: "Reste theorique", type: "number", width: 72, xlsxWidth: 18 },
      { key: "shortage_quantity", header: "Manquant", type: "number", width: 58, xlsxWidth: 14 }
    ],
    summaryItems: (summary) => [
      {
        label: "Lignes",
        value: Number(summary.total_rows || 0),
        rawValue: Number(summary.total_rows || 0),
        type: "integer"
      },
      {
        label: "Soldes negatifs",
        value: Number(summary.shortage_rows || 0),
        rawValue: Number(summary.shortage_rows || 0),
        type: "integer"
      },
      {
        label: "Unite filtree",
        value: summary.reporting_unit || "Toutes",
        rawValue: summary.reporting_unit || "Toutes"
      }
    ]
  },
  "stock-reconciliation": {
    title: "Rapprochement stock factures / vrac",
    subtitle:
      "Comparaison entre le vrac introduit en stock et la consommation theorique des produits factures",
    tableTitle: "Rapprochement par depot et article vrac",
    pdfLayout: "landscape",
    buildFilename: (filters) =>
      `rapprochement-stock-${filters.start_date || "debut"}-${
        filters.end_date || getTodayString()
      }`,
    columns: [
      { key: "warehouse_name", header: "Depot", width: 68, xlsxWidth: 18 },
      { key: "product_name", header: "Article vrac", width: 95, xlsxWidth: 26 },
      { key: "sku", header: "SKU", width: 48, xlsxWidth: 14 },
      { key: "reporting_unit", header: "Unite", width: 38, xlsxWidth: 10 },
      { key: "invoices_count", header: "Fact.", type: "integer", width: 38, xlsxWidth: 10 },
      { key: "finished_products_count", header: "Prod. finis", type: "integer", width: 52, xlsxWidth: 12 },
      { key: "recipe_required_quantity", header: "Conso. theorique", type: "number", width: 70, xlsxWidth: 17 },
      { key: "recorded_invoice_consumption", header: "Conso. compta.", type: "number", width: 70, xlsxWidth: 17 },
      { key: "bulk_entries", header: "Entrees vrac", type: "number", width: 62, xlsxWidth: 15 },
      { key: "transfer_in", header: "Transf. +", type: "number", width: 56, xlsxWidth: 14 },
      { key: "transfer_out", header: "Transf. -", type: "number", width: 56, xlsxWidth: 14 },
      { key: "available_bulk", header: "Vrac dispo.", type: "number", width: 62, xlsxWidth: 15 },
      { key: "reconciliation_gap", header: "Ecart vrac", type: "number", width: 62, xlsxWidth: 15 },
      { key: "recording_gap", header: "Ecart compta.", type: "number", width: 62, xlsxWidth: 15 },
      { key: "status", header: "Statut", width: 58, xlsxWidth: 16 },
      { key: "recording_status", header: "Compta.", width: 58, xlsxWidth: 16 }
    ],
    summaryItems: (summary) => [
      {
        label: "Lignes",
        value: Number(summary.total_rows || 0),
        rawValue: Number(summary.total_rows || 0),
        type: "integer"
      },
      {
        label: "Manquants",
        value: Number(summary.shortage_rows || 0),
        rawValue: Number(summary.shortage_rows || 0),
        type: "integer"
      },
      {
        label: "Surplus",
        value: Number(summary.surplus_rows || 0),
        rawValue: Number(summary.surplus_rows || 0),
        type: "integer"
      },
      {
        label: "Non comptabilises",
        value: Number(summary.unrecorded_rows || 0),
        rawValue: Number(summary.unrecorded_rows || 0),
        type: "integer"
      },
      {
        label: "Produits sans recette",
        value: Number(summary.unconfigured_invoice_items_count || 0),
        rawValue: Number(summary.unconfigured_invoice_items_count || 0),
        type: "integer"
      }
    ]
  }
};

async function getCustomerAgingPayload(query) {
  const asOfDate = parseDateFilter(query.as_of_date, getTodayString()) || getTodayString();
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const data = await getCustomerAgingReport({
    asOfDate,
    warehouseId
  });

  return {
    filters: {
      as_of_date: asOfDate,
      warehouse_id: warehouseId
    },
    ...data
  };
}

async function getSupplierAgingPayload(query) {
  const asOfDate = parseDateFilter(query.as_of_date, getTodayString()) || getTodayString();
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const data = await getSupplierAgingReport({
    asOfDate,
    warehouseId
  });

  return {
    filters: {
      as_of_date: asOfDate,
      warehouse_id: warehouseId
    },
    ...data
  };
}

async function getCollectionsPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const asOfDate =
    parseDateFilter(query.as_of_date, getTodayString()) || getTodayString();
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const paymentStatus = ["all", "open", "unpaid", "partial", "paid"].includes(
    String(query.payment_status || "all").trim().toLowerCase()
  )
    ? String(query.payment_status || "all").trim().toLowerCase()
    : "all";
  const alertLevel = [
    "all",
    "green",
    "light_green",
    "orange",
    "red"
  ].includes(String(query.alert_level || "all").trim().toLowerCase())
    ? String(query.alert_level || "all").trim().toLowerCase()
    : "all";

  return getCollectionsReport({
    startDate,
    endDate,
    asOfDate,
    warehouseId,
    customerId,
    customerCity: query.customer_city
      ? String(query.customer_city).trim()
      : null,
    paymentStatus,
    alertLevel,
    limit: parsePositiveLimit(query.limit, 5000, 5000)
  });
}

async function getCustomerLedgerPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const customerId = parsePositiveInteger(query.customer_id);

  const data = await getCustomerLedgerReport({
    startDate,
    endDate,
    customerId
  });

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      customer_id: customerId
    },
    ...data
  };
}

async function getSalesDetailPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const limit = parsePositiveLimit(query.limit, 200, 5000);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const productId = parsePositiveInteger(query.product_id);

  const data = await getSalesDetailReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId,
      productId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      product_id: productId,
      limit
    },
    ...data
  };
}

async function getProductSalesPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const warehouseIds = parsePositiveIntegerList(
    query.warehouse_ids ?? query.warehouse_id
  );
  const customerIds = parsePositiveIntegerList(
    query.customer_ids ?? query.customer_id
  );
  const productIds = parsePositiveIntegerList(
    query.product_ids ?? query.product_id
  );
  const invoiceStatus =
    query.invoice_status && String(query.invoice_status).trim()
      ? String(query.invoice_status).trim().toLowerCase()
      : null;

  const data = await getProductSalesReport(
    {
      startDate,
      endDate,
      warehouseIds,
      customerIds,
      productIds,
      invoiceStatus
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_ids: warehouseIds,
      customer_ids: customerIds,
      product_ids: productIds,
      invoice_status: invoiceStatus,
      limit
    },
    ...data
  };
}

async function getCategorySalesPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);

  const data = await getCategorySalesReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getCommercialSalesPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);

  const data = await getCommercialSalesReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getBreakEvenPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);

  const data = await getBreakEvenReport({
    startDate,
    endDate
  });

  return {
    filters: {
      start_date: startDate,
      end_date: endDate
    },
    ...data
  };
}

async function getIncomeStatementPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const data = await getIncomeStatementReport({
    startDate,
    endDate
  });

  return {
    filters: {
      start_date: startDate,
      end_date: endDate
    },
    ...data
  };
}

async function getTreasuryStatementPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const data = await getTreasuryStatementReport({
    startDate,
    endDate
  });

  return {
    filters: {
      start_date: startDate,
      end_date: endDate
    },
    ...data
  };
}

async function getReceiptsJournalPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getReceiptsJournalReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getExpensesJournalPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const category =
    query.category && String(query.category).trim()
      ? String(query.category).trim()
      : null;
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getExpensesJournalReport(
    {
      startDate,
      endDate,
      category
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      category,
      limit
    },
    ...data
  };
}

async function getExpenseCategoryPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const category =
    query.category && String(query.category).trim()
      ? String(query.category).trim()
      : null;
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getExpenseCategoryReport(
    {
      startDate,
      endDate,
      category
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      category,
      limit
    },
    ...data
  };
}

async function getMarginByCityPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getMarginByCityReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getMarginByCustomerPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getMarginByCustomerReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getBudgetVsActualPayload(query) {
  const budgetId = parsePositiveInteger(query.budget_id);
  const data = await getBudgetVsActualReport({
    budgetId
  });

  return {
    filters: {
      budget_id: budgetId
    },
    ...data
  };
}

async function getMarketingRatioPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const data = await getMarketingRatioReport({
    startDate,
    endDate
  });

  return {
    filters: {
      start_date: startDate,
      end_date: endDate
    },
    ...data
  };
}

async function getCommissionDuePayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const customerId = parsePositiveInteger(query.customer_id);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const data = await getCommissionDueReport(
    {
      startDate,
      endDate,
      warehouseId,
      customerId
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_id: warehouseId,
      customer_id: customerId,
      limit
    },
    ...data
  };
}

async function getProductLedgerPayload(query) {
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, null);
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const warehouseIds = parsePositiveIntegerList(
    query.warehouse_ids ?? query.warehouse_id
  );
  const customerIds = parsePositiveIntegerList(
    query.customer_ids ?? query.customer_id
  );
  const productIds = parsePositiveIntegerList(
    query.product_ids ?? query.product_id
  );
  const invoiceStatus =
    query.invoice_status && String(query.invoice_status).trim()
      ? String(query.invoice_status).trim().toLowerCase()
      : null;
  const invoiceNumber =
    query.invoice_number && String(query.invoice_number).trim()
      ? String(query.invoice_number).trim()
      : null;

  const data = await getProductLedgerReport(
    {
      startDate,
      endDate,
      warehouseIds,
      customerIds,
      productIds,
      invoiceStatus,
      invoiceNumber
    },
    limit
  );

  return {
    filters: {
      start_date: startDate,
      end_date: endDate,
      warehouse_ids: warehouseIds,
      customer_ids: customerIds,
      product_ids: productIds,
      invoice_status: invoiceStatus,
      invoice_number: invoiceNumber,
      limit
    },
    ...data
  };
}

async function getStockStatePayload(query) {
  const limit = parsePositiveLimit(query.limit, 500, 5000);
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const productId = parsePositiveInteger(query.product_id);
  const lowStockOnly = parseBoolean(query.low_stock_only);

  const data = await getStockStateReport(
    {
      warehouseId,
      productId,
      lowStockOnly
    },
    limit
  );

  return {
    filters: {
      warehouse_id: warehouseId,
      product_id: productId,
      low_stock_only: lowStockOnly,
      limit
    },
    ...data
  };
}

async function getBulkStockFlowPayload(query) {
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const productId = parsePositiveInteger(query.product_id);
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, getTodayString());
  const reportingUnit = ["kg", "l", "unit"].includes(
    String(query.unit || "").trim().toLowerCase()
  )
    ? String(query.unit).trim().toLowerCase()
    : null;
  const data = await getBulkStockFlowComparison({
    warehouseId,
    productId,
    startDate,
    endDate,
    reportingUnit
  });

  return {
    filters: {
      warehouse_id: warehouseId,
      product_id: productId,
      start_date: startDate,
      end_date: endDate,
      unit: reportingUnit
    },
    summary: {
      total_rows: data.rows.length,
      shortage_rows: data.rows.filter(
        (row) => Number(row.theoretical_remaining || 0) < 0
      ).length,
      reporting_unit: reportingUnit
    },
    ...data
  };
}

async function getStockReconciliationPayload(query) {
  const warehouseId = parsePositiveInteger(query.warehouse_id);
  const productId = parsePositiveInteger(query.product_id);
  const startDate = parseDateFilter(query.start_date, null);
  const endDate = parseDateFilter(query.end_date, getTodayString());
  const reportingUnit = ["kg", "l", "unit"].includes(
    String(query.unit || "").trim().toLowerCase()
  )
    ? String(query.unit).trim().toLowerCase()
    : null;
  const data = await getStockInvoiceBulkReconciliation({
    warehouseId,
    productId,
    startDate,
    endDate,
    reportingUnit
  });

  return {
    filters: {
      warehouse_id: warehouseId,
      product_id: productId,
      start_date: startDate,
      end_date: endDate,
      unit: reportingUnit
    },
    ...data
  };
}

async function getCashForecastPayload(query) {
  const detailLimit = parsePositiveLimit(query.detail_limit, 10, 200);
  const forecast = await getCashForecast(detailLimit);

  return {
    filters: {
      generated_at: getTodayString(),
      detail_limit: detailLimit
    },
    summary: forecast.summary || {},
    rows: forecast.horizons || [],
    horizons: forecast.horizons || [],
    receivables: forecast.receivables || [],
    payables: forecast.payables || []
  };
}

async function getMonthlyClosePayload(query) {
  const now = new Date();
  const year = parseYear(query.year, now.getFullYear());
  const month = parseMonth(query.month, now.getMonth() + 1);
  const detailLimit = parsePositiveLimit(query.detail_limit, 10, 100);

  return getMonthlyClosePack({
    year,
    month,
    detailLimit
  });
}

const reportLoaders = {
  collections: getCollectionsPayload,
  "customer-aging": getCustomerAgingPayload,
  "supplier-aging": getSupplierAgingPayload,
  "customer-ledger": getCustomerLedgerPayload,
  "sales-detail": getSalesDetailPayload,
  "sales-by-category": getCategorySalesPayload,
  "sales-by-commercial": getCommercialSalesPayload,
  "break-even": getBreakEvenPayload,
  "income-statement": getIncomeStatementPayload,
  "treasury-statement": getTreasuryStatementPayload,
  "receipts-journal": getReceiptsJournalPayload,
  "expenses-journal": getExpensesJournalPayload,
  "expenses-by-category": getExpenseCategoryPayload,
  "margin-by-city": getMarginByCityPayload,
  "margin-by-customer": getMarginByCustomerPayload,
  "budget-vs-actual": getBudgetVsActualPayload,
  "marketing-ratio": getMarketingRatioPayload,
  "commission-due": getCommissionDuePayload,
  "product-ledger": getProductLedgerPayload,
  "product-sales": getProductSalesPayload,
  "stock-state": getStockStatePayload,
  "bulk-stock-flow": getBulkStockFlowPayload,
  "stock-reconciliation": getStockReconciliationPayload,
  "cash-forecast": getCashForecastPayload
};

function getReportConfigOrThrow(reportKey) {
  const definition = reportDefinitions[reportKey] || null;
  const loadReport = reportLoaders[reportKey] || null;

  if (!definition || !loadReport) {
    const error = new Error("Etat introuvable.");
    error.statusCode = 404;
    throw error;
  }

  return {
    definition,
    loadReport
  };
}

async function respondWithTableReport(req, res, next, reportKey) {
  try {
    const { loadReport } = getReportConfigOrThrow(reportKey);
    const data = await loadReport(req.query);

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export function getCustomerAgingReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "customer-aging");
}

export function getCollectionsReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "collections");
}

export function getSupplierAgingReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "supplier-aging");
}

export function getCustomerLedgerReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "customer-ledger");
}

export function getSalesDetailReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "sales-detail");
}

export function getProductLedgerReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "product-ledger");
}

export function getProductSalesReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "product-sales");
}

export function getCategorySalesReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "sales-by-category");
}

export function getCommercialSalesReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "sales-by-commercial");
}

export function getBreakEvenReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "break-even");
}

export function getIncomeStatementReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "income-statement");
}

export function getTreasuryStatementReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "treasury-statement");
}

export function getReceiptsJournalReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "receipts-journal");
}

export function getExpensesJournalReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "expenses-journal");
}

export function getExpenseCategoryReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "expenses-by-category");
}

export function getMarginByCityReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "margin-by-city");
}

export function getMarginByCustomerReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "margin-by-customer");
}

export function getBudgetVsActualReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "budget-vs-actual");
}

export function getMarketingRatioReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "marketing-ratio");
}

export function getCommissionDueReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "commission-due");
}

export function getStockStateReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "stock-state");
}

export function getBulkStockFlowReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "bulk-stock-flow");
}

export function getStockReconciliationReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "stock-reconciliation");
}

export async function getCashForecastReportHandler(req, res, next) {
  try {
    const data = await getCashForecastPayload(req.query);

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getMonthlyCloseReportHandler(req, res, next) {
  try {
    const data = await getMonthlyClosePayload(req.query);

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function exportReportHandler(req, res, next) {
  try {
    const reportKey = String(req.params.reportKey || "").trim().toLowerCase();
    const format = String(req.params.format || "").trim().toLowerCase();

    if (!["pdf", "xlsx"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Format d'export invalide."
      });
    }

    if (reportKey === "cash-forecast") {
      const data = await getCashForecastPayload(req.query);
      const filename = buildExportFilename(
        `tresorerie-previsionnelle-${getTodayString()}`,
        format
      );

      if (format === "pdf") {
        const buffer = await createCashForecastPdfBuffer(data);
        return sendDownloadBuffer(res, buffer, filename, "application/pdf");
      }

      const buffer = await createCashForecastXlsxBuffer(data);
      return sendDownloadBuffer(
        res,
        buffer,
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    }

    if (reportKey === "monthly-close") {
      const data = await getMonthlyClosePayload(req.query);
      const filename = buildExportFilename(
        `pack-cloture-${data.period?.year || ""}-${String(
          data.period?.month || ""
        ).padStart(2, "0")}`,
        format
      );

      if (format === "pdf") {
        const buffer = await createMonthlyClosePackPdfBuffer(data);
        return sendDownloadBuffer(res, buffer, filename, "application/pdf");
      }

      const buffer = await createMonthlyClosePackXlsxBuffer(data);
      return sendDownloadBuffer(
        res,
        buffer,
        filename,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    }

    const { definition, loadReport } = getReportConfigOrThrow(reportKey);
    const data = await loadReport(req.query);
    const filename = buildExportFilename(
      definition.buildFilename(data.filters || {}),
      format
    );

    if (format === "pdf") {
      const buffer = await createTabularReportPdfBuffer(definition, data);
      return sendDownloadBuffer(res, buffer, filename, "application/pdf");
    }

    const buffer = await createTabularReportXlsxBuffer(definition, data);
    return sendDownloadBuffer(
      res,
      buffer,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  } catch (error) {
    next(error);
  }
}
