import express from "express";
import {
  createStockEntryHandler,
  createStockExitHandler,
  createStockAdjustmentHandler,
  getWarehouseStockHandler,
  getAllStockSummaryHandler,
  getStockMovementsHandler
} from "../controllers/stock.controller.js";

const router = express.Router();

router.get("/", getAllStockSummaryHandler);
router.get("/movements", getStockMovementsHandler);
router.get("/warehouse/:warehouseId", getWarehouseStockHandler);

router.post("/entry", createStockEntryHandler);
router.post("/exit", createStockExitHandler);
router.post("/adjustment", createStockAdjustmentHandler);

export default router;