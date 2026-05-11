import express from "express";
import {
  exportReportHandler,
  getCashForecastReportHandler,
  getCustomerAgingReportHandler,
  getMonthlyCloseReportHandler,
  getProductSalesReportHandler,
  getSupplierAgingReportHandler,
  getSalesDetailReportHandler,
  getStockStateReportHandler
} from "../controllers/report.controller.js";

const router = express.Router();

router.get("/customer-aging", getCustomerAgingReportHandler);
router.get("/supplier-aging", getSupplierAgingReportHandler);
router.get("/sales-detail", getSalesDetailReportHandler);
router.get("/product-sales", getProductSalesReportHandler);
router.get("/stock-state", getStockStateReportHandler);
router.get("/cash-forecast", getCashForecastReportHandler);
router.get("/monthly-close", getMonthlyCloseReportHandler);
router.get("/:reportKey/export/:format", exportReportHandler);

export default router;
