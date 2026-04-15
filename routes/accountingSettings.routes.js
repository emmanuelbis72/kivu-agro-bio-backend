import express from "express";
import {
  getAccountingSettingsOverviewHandler,
  upsertExpenseCategoryAccountHandler,
  upsertPaymentMethodAccountHandler
} from "../controllers/accountingSettings.controller.js";

const router = express.Router();

router.get("/", getAccountingSettingsOverviewHandler);
router.put("/expense-categories", upsertExpenseCategoryAccountHandler);
router.put("/payment-methods", upsertPaymentMethodAccountHandler);

export default router;