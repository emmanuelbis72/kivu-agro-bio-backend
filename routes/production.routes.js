import express from "express";
import {
  getRecipesByFinishedProductHandler,
  createOrUpdateRecipeItemHandler,
  deleteRecipeItemHandler,
  createProductionBatchHandler,
  getProductionBatchesHandler,
  getProductionBatchByIdHandler
} from "../controllers/production.controller.js";

const router = express.Router();

/* ================= RECETTES ================= */
router.get("/recipes/:finishedProductId", getRecipesByFinishedProductHandler);
router.post("/recipes", createOrUpdateRecipeItemHandler);
router.delete("/recipes/:id", deleteRecipeItemHandler);

/* ================= PRODUCTION ================= */
router.post("/batches", createProductionBatchHandler);
router.get("/batches", getProductionBatchesHandler);
router.get("/batches/:id", getProductionBatchByIdHandler);

export default router;