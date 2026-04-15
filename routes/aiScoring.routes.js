import express from "express";
import {
  getAIScoringSummaryHandler,
  getProductScoresHandler,
  getCustomerScoresHandler,
  getCashScoreHandler
} from "../controllers/aiScoring.controller.js";

const router = express.Router();

router.get("/summary", getAIScoringSummaryHandler);
router.get("/products", getProductScoresHandler);
router.get("/customers", getCustomerScoresHandler);
router.get("/cash", getCashScoreHandler);

export default router;