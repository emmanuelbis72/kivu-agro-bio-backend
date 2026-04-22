import express from "express";
import {
  getAIScoringSummaryHandler,
  getProductScoresHandler,
  getCustomerScoresHandler,
  getCashScoreHandler,
  syncCustomerScoresHandler
} from "../controllers/aiScoring.controller.js";

const router = express.Router();

router.get("/summary", getAIScoringSummaryHandler);
router.get("/products", getProductScoresHandler);
router.get("/customers", getCustomerScoresHandler);
router.post("/customers/sync", syncCustomerScoresHandler);
router.get("/cash", getCashScoreHandler);

export default router;
