import express from "express";
import {
  askAIHandler,
  getQuickQuestionsHandler,
  getAIHistoryHandler,
  getBusinessRulesHandler,
  updateBusinessRuleHandler,
  getCEOBRIEFHandler
} from "../controllers/ai.controller.js";

const router = express.Router();

/* ================= IA CHAT ================= */
router.post("/ask", askAIHandler);
router.get("/quick-questions", getQuickQuestionsHandler);
router.get("/history", getAIHistoryHandler);

/* ================= CEO REASONING ================= */
router.get("/ceo-brief", getCEOBRIEFHandler);

/* ================= BUSINESS RULES ================= */
router.get("/business-rules", getBusinessRulesHandler);
router.put("/business-rules/:ruleKey", updateBusinessRuleHandler);

export default router;