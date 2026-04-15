import {
  getGlobalStats,
  getStockAlerts,
  getTopProducts,
  getTopCustomers,
  getRecentInvoices,
  getRecentPayments,
  getSalesOverview,
  getSalesByWarehouse,
  getProductCategoryStats,
  getLowRotationProducts,
  getAccountingGlobalStats,
  getAccountingMonthlyOverview,
  getAccountClassBalances,
  getRecentJournalEntries
} from "../models/dashboard.model.js";

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

export async function getDashboardOverviewHandler(req, res, next) {
  try {
    const topLimit = parsePositiveLimit(req.query.top_limit, 10, 50);
    const recentLimit = parsePositiveLimit(req.query.recent_limit, 10, 50);

    const [
      globalStats,
      stockAlerts,
      topProducts,
      topCustomers,
      recentInvoices,
      recentPayments,
      salesOverview,
      salesByWarehouse,
      productCategoryStats,
      lowRotationProducts
    ] = await Promise.all([
      getGlobalStats(),
      getStockAlerts(),
      getTopProducts(topLimit),
      getTopCustomers(topLimit),
      getRecentInvoices(recentLimit),
      getRecentPayments(recentLimit),
      getSalesOverview(),
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
        recent_invoices: recentInvoices,
        recent_payments: recentPayments,
        sales_overview: salesOverview,
        sales_by_warehouse: salesByWarehouse,
        product_category_stats: productCategoryStats,
        low_rotation_products: lowRotationProducts
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getAccountingDashboardOverviewHandler(req, res, next) {
  try {
    const recentLimit = parsePositiveLimit(req.query.recent_limit, 10, 50);

    const [
      accountingStats,
      monthlyOverview,
      classBalances,
      recentJournalEntries
    ] = await Promise.all([
      getAccountingGlobalStats(),
      getAccountingMonthlyOverview(),
      getAccountClassBalances(),
      getRecentJournalEntries(recentLimit)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        accounting_global_stats: accountingStats,
        accounting_monthly_overview: monthlyOverview,
        account_class_balances: classBalances,
        recent_journal_entries: recentJournalEntries
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