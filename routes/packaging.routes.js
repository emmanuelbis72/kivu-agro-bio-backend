import express from "express";
import {
  createPackagingConsumptionHandler,
  createPackagingReplenishmentHandler,
  getFinishedProductPackagingConfigsHandler,
  getPackagingConsumptionsHandler,
  getPackagingOverviewHandler,
  getPackagingProductsHandler,
  getPackagingReplenishmentsHandler,
  updateFinishedProductPackagingConfigHandler,
  updatePackagingProductTypeHandler
} from "../controllers/packaging.controller.js";

const router = express.Router();

router.get("/products", getPackagingProductsHandler);
router.put("/products/:productId/type", updatePackagingProductTypeHandler);
router.get(
  "/finished-products/configs",
  getFinishedProductPackagingConfigsHandler
);
router.put(
  "/finished-products/:productId/config",
  updateFinishedProductPackagingConfigHandler
);
router.get("/overview", getPackagingOverviewHandler);
router.get("/consumptions", getPackagingConsumptionsHandler);
router.post("/consumptions", createPackagingConsumptionHandler);
router.get("/replenishments", getPackagingReplenishmentsHandler);
router.post("/replenishments", createPackagingReplenishmentHandler);

export default router;
