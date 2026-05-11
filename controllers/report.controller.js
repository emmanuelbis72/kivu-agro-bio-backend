import { getCashForecast } from "../models/dashboard.model.js";
import { getMonthlyClosePack } from "../models/monthlyClose.model.js";
import {
  getCustomerAgingReport,
  getProductSalesReport,
  getSupplierAgingReport,
  getSalesDetailReport,
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
  "customer-aging": getCustomerAgingPayload,
  "supplier-aging": getSupplierAgingPayload,
  "sales-detail": getSalesDetailPayload,
  "product-sales": getProductSalesPayload,
  "stock-state": getStockStatePayload,
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

export function getSupplierAgingReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "supplier-aging");
}

export function getSalesDetailReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "sales-detail");
}

export function getProductSalesReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "product-sales");
}

export function getStockStateReportHandler(req, res, next) {
  return respondWithTableReport(req, res, next, "stock-state");
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
