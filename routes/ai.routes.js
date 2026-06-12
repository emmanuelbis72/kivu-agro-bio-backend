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
import {
  ROLE_GROUPS,
  requireAuthentication,
  requireConfiguredAuthentication,
  requireConfiguredRoles,
  requireRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/ask",
  requireConfiguredAuthentication,
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  askAIHandler
);
router.get("/quick-questions", getQuickQuestionsHandler);
router.get(
  "/history",
  requireConfiguredAuthentication,
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  getAIHistoryHandler
);

router.get(
  "/ceo-brief",
  requireConfiguredAuthentication,
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  getCEOBRIEFHandler
);

router.get(
  "/business-rules",
  requireConfiguredAuthentication,
  getBusinessRulesHandler
);
router.put(
  "/business-rules/:ruleKey",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive),
  updateBusinessRuleHandler
);

router.post(
  "/alerts/sync",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  syncAIAlertsHandler
);
router.get("/alerts", requireConfiguredAuthentication, getAIAlertsStoreHandler);
router.patch(
  "/alerts/:id/resolve",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  resolveAIAlertHandler
);

router.post(
  "/forecasts/sync",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  syncAIForecastsHandler
);
router.get(
  "/forecasts",
  requireConfiguredAuthentication,
  getAIForecastsHandler
);

router.get(
  "/recommendations",
  requireConfiguredAuthentication,
  getAIRecommendationsHandler
);
router.post(
  "/recommendations",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive),
  createAIRecommendationHandler
);
router.patch(
  "/recommendations/:id/decision",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive),
  decideAIRecommendationHandler
);

export default router;
