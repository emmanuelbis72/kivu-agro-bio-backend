import express from "express";
import kabotController from "../controllers/kabot.controller.js";

const router = express.Router();

const {
  getKabotAlertsHandler,
  getKabotCustomerScoringHandler,
  getKabotProductScoringHandler
} = kabotController;

/* ================= KABOT PHASE 2 ================= */
router.get("/alerts", getKabotAlertsHandler);
router.get("/scoring/customers", getKabotCustomerScoringHandler);
router.get("/scoring/products", getKabotProductScoringHandler);

export default router;