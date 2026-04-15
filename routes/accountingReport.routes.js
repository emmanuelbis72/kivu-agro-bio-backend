import express from "express";
import {
  getGeneralLedgerHandler,
  downloadGeneralLedgerPdfHandler,
  getTrialBalanceHandler,
  downloadTrialBalancePdfHandler,
  getIncomeStatementHandler,
  getBalanceSheetHandler
} from "../controllers/accountingReport.controller.js";

const router = express.Router();

router.get("/general-ledger", getGeneralLedgerHandler);
router.get("/general-ledger/pdf", downloadGeneralLedgerPdfHandler);

router.get("/trial-balance", getTrialBalanceHandler);
router.get("/trial-balance/pdf", downloadTrialBalancePdfHandler);

router.get("/income-statement", getIncomeStatementHandler);
router.get("/balance-sheet", getBalanceSheetHandler);

export default router;