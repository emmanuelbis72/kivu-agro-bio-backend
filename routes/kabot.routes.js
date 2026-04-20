import express from "express";
import {
  getKabotAlertsHandler,
  getKabotCustomerScoringHandler,
  getKabotProductScoringHandler
} from "../controllers/kabot.controller.js";

const router = express.Router();

/* ================= KABOT PHASE 2 ================= */
router.get("/alerts", getKabotAlertsHandler);
router.get("/scoring/customers", getKabotCustomerScoringHandler);
router.get("/scoring/products", getKabotProductScoringHandler);

export default router;