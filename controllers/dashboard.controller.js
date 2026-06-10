import {
  getGlobalStats,
  getStockAlerts,
  getStockVariationOverview,
  getStockVariationByMovementType,
  getStockVariationByProduct,
  getStockVariationByWarehouse,
  getStockVariationTimeline,
  getRecentStockVariationMovements,
  getTopProducts,
  getTopCustomers,
  getCustomerBalanceBoard,
  getExecutiveKpiSnapshot,
  getExecutiveAnalyticsDashboard,
  getRecentInvoices,
  getRecentPayments,
  getExecutiveComparisonTimeline,
  getSalesOverview,
  getSalesByWarehouse,
  getProductCategoryStats,
  getLowRotationProducts,
  getAccountingGlobalStats,
  getAccountingMonthlyOverview,
  getAccountClassBalances,
  getRecentJournalEntries,
  getCashForecast,
  getCommercialDashboard,
  getCollectionsDashboard,
  getAccountingHealthSnapshot
} from "../models/dashboard.model.js";
import { getBreakEvenReport } from "../models/report.model.js";

function parsePositiveLimit(value, defaultValue = 10, maxValue = 100) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveDaysWindow(value, defaultValue = 365, maxValue = 3650) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function parseDateFilter(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseCollectionEntryType(value) {
  const normalized = String(value || "all").trim().toLowerCase();
  return ["all", "invoices", "payments"].includes(normalized)
    ? normalized
    : "all";
}

function parseStockVariationFilters(query = {}) {
  return {
    warehouseId: parsePositiveInteger(query.warehouse_id),
    productId: parsePositiveInteger(query.product_id),
    stockForm: query.stock_form ? String(query.stock_form).trim().toLowerCase() : null,
    startDate: parseDateFilter(query.start_date),
    endDate: parseDateFilter(query.end_date)
  };
}

export async function getDashboardOverviewHandler(req, res, next) {
  try {
    const topLimit = parsePositiveLimit(req.query.top_limit, 10, 50);
    const recentLimit = parsePositiveLimit(req.query.recent_limit, 10, 50);

    const [
      globalStats,
      stockAlerts,
      topProducts,
      topCustomers,
      executiveKpiSnapshot,
      customerBalanceBoard,
      recentInvoices,
      recentPayments,
      salesOverview,
      executiveComparisonTimeline,
      salesByWarehouse,
      productCategoryStats,
      lowRotationProducts
    ] = await Promise.all([
      getGlobalStats(),
      getStockAlerts(),
      getTopProducts(topLimit),
      getTopCustomers(topLimit),
      getExecutiveKpiSnapshot(),
      getCustomerBalanceBoard(),
      getRecentInvoices(recentLimit),
      getRecentPayments(recentLimit),
      getSalesOverview(),
      getExecutiveComparisonTimeline(6),
      getSalesByWarehouse(),
      getProductCategoryStats(),
      getLowRotationProducts(topLimit)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        global_stats: globalStats,
        stock_alerts: stockAlerts,
        top_products: topProducts,
        top_customers: topCustomers,
        executive_kpi_snapshot: executiveKpiSnapshot,
        customer_balance_board: customerBalanceBoard,
        recent_invoices: recentInvoices,
        recent_payments: recentPayments,
        sales_overview: salesOverview,
        executive_comparison_timeline: executiveComparisonTimeline,
        sales_by_warehouse: salesByWarehouse,
        product_category_stats: productCategoryStats,
        low_rotation_products: lowRotationProducts
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getCustomerBalanceBoardHandler(req, res, next) {
  try {
    const now = new Date();
    const defaultEndDate = now.toISOString().split("T")[0];
    const defaultStartDate = new Date(
      now.getFullYear(),
      now.getMonth() - 5,
      1
    )
      .toISOString()
      .split("T")[0];

    const data = await getCustomerBalanceBoard({
      startDate: parseDateFilter(req.query.start_date) || defaultStartDate,
      endDate: parseDateFilter(req.query.end_date) || defaultEndDate,
      warehouseId: parsePositiveInteger(req.query.warehouse_id),
      customerId: parsePositiveInteger(req.query.customer_id)
    });

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getExecutiveAnalyticsDashboardHandler(req, res, next) {
  try {
    const topLimit = parsePositiveLimit(req.query.top_limit, 10, 20);
    const warehouseId = parsePositiveInteger(req.query.warehouse_id);
    const startDate = parseDateFilter(req.query.start_date);
    const endDate = parseDateFilter(req.query.end_date);

    const data = await getExecutiveAnalyticsDashboard({
      topLimit,
      warehouseId,
      startDate,
      endDate
    });

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountingDashboardOverviewHandler(req, res, next) {
  try {
    const recentLimit = parsePositiveLimit(req.query.recent_limit, 10, 50);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const today = now.toISOString().split("T")[0];

    const [
      accountingStats,
      businessStats,
      monthlyOverview,
      classBalances,
      recentJournalEntries,
      cashForecast,
      accountingHealth,
      breakEvenAnalysis
    ] = await Promise.all([
      getAccountingGlobalStats(),
      getGlobalStats(),
      getAccountingMonthlyOverview(),
      getAccountClassBalances(),
      getRecentJournalEntries(recentLimit),
      getCashForecast(recentLimit),
      getAccountingHealthSnapshot(),
      getBreakEvenReport({
        startDate: monthStart,
        endDate: today
      })
    ]);

    return res.status(200).json({
      success: true,
      data: {
        accounting_global_stats: accountingStats,
        business_global_stats: businessStats,
        accounting_monthly_overview: monthlyOverview,
        account_class_balances: classBalances,
        recent_journal_entries: recentJournalEntries,
        cash_forecast: cashForecast,
        accounting_health: accountingHealth,
        break_even_analysis: breakEvenAnalysis
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getGlobalStatsHandler(req, res, next) {
  try {
    const stats = await getGlobalStats();

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountingGlobalStatsHandler(req, res, next) {
  try {
    const stats = await getAccountingGlobalStats();

    return res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountingMonthlyOverviewHandler(req, res, next) {
  try {
    const rows = await getAccountingMonthlyOverview();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountClassBalancesHandler(req, res, next) {
  try {
    const rows = await getAccountClassBalances();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getRecentJournalEntriesHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getRecentJournalEntries(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getStockAlertsHandler(req, res, next) {
  try {
    const alerts = await getStockAlerts();

    return res.status(200).json({
      success: true,
      count: alerts.length,
      data: alerts
    });
  } catch (error) {
    next(error);
  }
}

export async function getTopProductsHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getTopProducts(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getTopCustomersHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getTopCustomers(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getRecentInvoicesHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getRecentInvoices(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getRecentPaymentsHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getRecentPayments(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getSalesOverviewHandler(req, res, next) {
  try {
    const rows = await getSalesOverview();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getSalesByWarehouseHandler(req, res, next) {
  try {
    const rows = await getSalesByWarehouse();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductCategoryStatsHandler(req, res, next) {
  try {
    const rows = await getProductCategoryStats();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getLowRotationProductsHandler(req, res, next) {
  try {
    const limit = parsePositiveLimit(req.query.limit, 10, 100);
    const rows = await getLowRotationProducts(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getStockVariationReportHandler(req, res, next) {
  try {
    const filters = parseStockVariationFilters(req.query);
    const topLimit = parsePositiveLimit(req.query.top_limit, 10, 100);
    const recentLimit = parsePositiveLimit(req.query.recent_limit, 20, 100);
    const timelineGranularity =
      String(req.query.timeline || "day").trim().toLowerCase() === "month"
        ? "month"
        : "day";

    const [
      overview,
      byMovementType,
      byProduct,
      byWarehouse,
      timeline,
      recentMovements
    ] = await Promise.all([
      getStockVariationOverview(filters),
      getStockVariationByMovementType(filters),
      getStockVariationByProduct(filters, topLimit),
      getStockVariationByWarehouse(filters, topLimit),
      getStockVariationTimeline(filters, timelineGranularity),
      getRecentStockVariationMovements(filters, recentLimit)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        filters: {
          warehouse_id: filters.warehouseId,
          product_id: filters.productId,
          stock_form: filters.stockForm,
          start_date: filters.startDate,
          end_date: filters.endDate,
          timeline: timelineGranularity
        },
        overview,
        by_movement_type: byMovementType,
        by_product: byProduct,
        by_warehouse: byWarehouse,
        timeline,
        recent_movements: recentMovements
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getCommercialDashboardHandler(req, res, next) {
  try {
    const periodDays = parsePositiveDaysWindow(req.query.days, 365, 3650);
    const topLimit = parsePositiveLimit(req.query.top_limit, 10, 50);
    const heatmapFilters = {
      days: parsePositiveDaysWindow(
        req.query.heatmap_days,
        periodDays,
        3650
      ),
      warehouseId: parsePositiveInteger(req.query.heatmap_warehouse_id),
      chainName: req.query.heatmap_chain_name
        ? String(req.query.heatmap_chain_name).trim()
        : null,
      salesChannel: req.query.heatmap_sales_channel
        ? String(req.query.heatmap_sales_channel).trim()
        : null,
      topProducts: parsePositiveLimit(req.query.heatmap_top_products, topLimit, 20),
      topCities: parsePositiveLimit(req.query.heatmap_top_cities, topLimit, 20)
    };
    const dashboard = await getCommercialDashboard(
      periodDays,
      topLimit,
      heatmapFilters
    );

    return res.status(200).json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    next(error);
  }
}

export async function getCollectionsDashboardHandler(req, res, next) {
  try {
    const now = new Date();
    const defaultEndDate = now.toISOString().split("T")[0];
    const defaultStartDate = new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const dashboard = await getCollectionsDashboard({
      startDate: parseDateFilter(req.query.start_date) || defaultStartDate,
      endDate: parseDateFilter(req.query.end_date) || defaultEndDate,
      warehouseId: parsePositiveInteger(req.query.warehouse_id),
      customerId: parsePositiveInteger(req.query.customer_id),
      customerCity: req.query.customer_city
        ? String(req.query.customer_city).trim()
        : null,
      entryType: parseCollectionEntryType(req.query.entry_type),
      topProducts: parsePositiveLimit(req.query.top_products, 8, 20),
      topCities: parsePositiveLimit(req.query.top_cities, 8, 20),
      invoiceLimit: parsePositiveLimit(req.query.invoice_limit, 80, 200),
      paymentLimit: parsePositiveLimit(req.query.payment_limit, 80, 200)
    });

    return res.status(200).json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    next(error);
  }
}
