import express from "express";
import {
  getDashboardOverviewHandler,
  getAccountingDashboardOverviewHandler,
  getGlobalStatsHandler,
  getAccountingGlobalStatsHandler,
  getAccountingMonthlyOverviewHandler,
  getAccountClassBalancesHandler,
  getRecentJournalEntriesHandler,
  getStockAlertsHandler,
  getTopProductsHandler,
  getTopCustomersHandler,
  getRecentInvoicesHandler,
  getRecentPaymentsHandler,
  getSalesOverviewHandler,
  getSalesByWarehouseHandler,
  getProductCategoryStatsHandler,
  getLowRotationProductsHandler
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/overview", getDashboardOverviewHandler);
router.get("/accounting-overview", getAccountingDashboardOverviewHandler);

router.get("/stats", getGlobalStatsHandler);
router.get("/accounting-stats", getAccountingGlobalStatsHandler);
router.get("/accounting-monthly", getAccountingMonthlyOverviewHandler);
router.get("/account-class-balances", getAccountClassBalancesHandler);
router.get("/recent-journal-entries", getRecentJournalEntriesHandler);

router.get("/stock-alerts", getStockAlertsHandler);
router.get("/top-products", getTopProductsHandler);
router.get("/top-customers", getTopCustomersHandler);
router.get("/recent-invoices", getRecentInvoicesHandler);
router.get("/recent-payments", getRecentPaymentsHandler);
router.get("/sales-overview", getSalesOverviewHandler);
router.get("/sales-by-warehouse", getSalesByWarehouseHandler);
router.get("/product-categories", getProductCategoryStatsHandler);
router.get("/low-rotation-products", getLowRotationProductsHandler);

export default router;