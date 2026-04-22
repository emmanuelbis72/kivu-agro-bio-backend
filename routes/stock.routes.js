import express from "express";
import {
  createStockEntryHandler,
  createStockExitHandler,
  createStockAdjustmentHandler,
  createBulkToPackageTransformHandler,
  createStockMixtureHandler,
  getWarehouseStockHandler,
  getAllStockSummaryHandler,
  getStockMovementsHandler,
  createStockTransferHandler,
  getStockTransfersHandler,
  getStockTransferByIdHandler
} from "../controllers/stock.controller.js";

const router = express.Router();

router.get("/", getAllStockSummaryHandler);
router.get("/movements", getStockMovementsHandler);
router.get("/warehouse/:warehouseId", getWarehouseStockHandler);

router.post("/transfer", createStockTransferHandler);
router.post("/transform/package", createBulkToPackageTransformHandler);
router.post("/transform/mixture", createStockMixtureHandler);
router.get("/transfers", getStockTransfersHandler);
router.get("/transfers/:id", getStockTransferByIdHandler);

router.post("/entry", createStockEntryHandler);
router.post("/exit", createStockExitHandler);
router.post("/adjustment", createStockAdjustmentHandler);

export default router;
