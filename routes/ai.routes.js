import express from "express";
import {
  askAIHandler,
  getQuickQuestionsHandler,
  getAIHistoryHandler,
  getBusinessRulesHandler
} from "../controllers/ai.controller.js";

const router = express.Router();

router.post("/ask", askAIHandler);
router.get("/quick-questions", getQuickQuestionsHandler);
router.get("/history", getAIHistoryHandler);
router.get("/business-rules", getBusinessRulesHandler);

export default router;