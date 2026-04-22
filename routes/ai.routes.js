import express from "express";
import {
  askAIHandler,
  createAIRecommendationHandler,
  decideAIRecommendationHandler,
  getAIAlertsStoreHandler,
  getAIForecastsHandler,
  getAIHistoryHandler,
  getAIRecommendationsHandler,
  getBusinessRulesHandler,
  getCEOBRIEFHandler,
  getQuickQuestionsHandler,
  resolveAIAlertHandler,
  syncAIForecastsHandler,
  syncAIAlertsHandler,
  updateBusinessRuleHandler
} from "../controllers/ai.controller.js";

const router = express.Router();

router.post("/ask", askAIHandler);
router.get("/quick-questions", getQuickQuestionsHandler);
router.get("/history", getAIHistoryHandler);

router.get("/ceo-brief", getCEOBRIEFHandler);

router.get("/business-rules", getBusinessRulesHandler);
router.put("/business-rules/:ruleKey", updateBusinessRuleHandler);

router.post("/alerts/sync", syncAIAlertsHandler);
router.get("/alerts", getAIAlertsStoreHandler);
router.patch("/alerts/:id/resolve", resolveAIAlertHandler);

router.post("/forecasts/sync", syncAIForecastsHandler);
router.get("/forecasts", getAIForecastsHandler);

router.get("/recommendations", getAIRecommendationsHandler);
router.post("/recommendations", createAIRecommendationHandler);
router.patch("/recommendations/:id/decision", decideAIRecommendationHandler);

export default router;
