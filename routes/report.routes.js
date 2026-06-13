import express from "express";
import {
  getBudgetVsActualReportHandler,
  getBreakEvenReportHandler,
  getCommissionDueReportHandler,
  getExpenseCategoryReportHandler,
  getExpensesJournalReportHandler,
  exportReportHandler,
  getCashForecastReportHandler,
  getCategorySalesReportHandler,
  getCommercialSalesReportHandler,
  getCollectionsReportHandler,
  getCustomerAgingReportHandler,
  getCustomerLedgerReportHandler,
  getIncomeStatementReportHandler,
  getMarginByCityReportHandler,
  getMarginByCustomerReportHandler,
  getMarketingRatioReportHandler,
  getMonthlyCloseReportHandler,
  getProductLedgerReportHandler,
  getProductSalesReportHandler,
  getReceiptsJournalReportHandler,
  getSupplierAgingReportHandler,
  getSalesDetailReportHandler,
  getTreasuryStatementReportHandler,
  getStockStateReportHandler
} from "../controllers/report.controller.js";

const router = express.Router();

router.get("/collections", getCollectionsReportHandler);
router.get("/customer-aging", getCustomerAgingReportHandler);
router.get("/customer-ledger", getCustomerLedgerReportHandler);
router.get("/supplier-aging", getSupplierAgingReportHandler);
router.get("/sales-detail", getSalesDetailReportHandler);
router.get("/sales-by-category", getCategorySalesReportHandler);
router.get("/sales-by-commercial", getCommercialSalesReportHandler);
router.get("/break-even", getBreakEvenReportHandler);
router.get("/income-statement", getIncomeStatementReportHandler);
router.get("/treasury-statement", getTreasuryStatementReportHandler);
router.get("/receipts-journal", getReceiptsJournalReportHandler);
router.get("/expenses-journal", getExpensesJournalReportHandler);
router.get("/expenses-by-category", getExpenseCategoryReportHandler);
router.get("/margin-by-city", getMarginByCityReportHandler);
router.get("/margin-by-customer", getMarginByCustomerReportHandler);
router.get("/budget-vs-actual", getBudgetVsActualReportHandler);
router.get("/marketing-ratio", getMarketingRatioReportHandler);
router.get("/commission-due", getCommissionDueReportHandler);
router.get("/product-ledger", getProductLedgerReportHandler);
router.get("/product-sales", getProductSalesReportHandler);
router.get("/stock-state", getStockStateReportHandler);
router.get("/cash-forecast", getCashForecastReportHandler);
router.get("/monthly-close", getMonthlyCloseReportHandler);
router.get("/:reportKey/export/:format", exportReportHandler);

export default router;
