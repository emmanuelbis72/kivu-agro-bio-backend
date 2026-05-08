import express from "express";
import {
  createPackagingConsumptionHandler,
  getPackagingConsumptionsHandler,
  getPackagingOverviewHandler,
  getPackagingProductsHandler,
  updatePackagingProductTypeHandler
} from "../controllers/packaging.controller.js";

const router = express.Router();

router.get("/products", getPackagingProductsHandler);
router.put("/products/:productId/type", updatePackagingProductTypeHandler);
router.get("/overview", getPackagingOverviewHandler);
router.get("/consumptions", getPackagingConsumptionsHandler);
router.post("/consumptions", createPackagingConsumptionHandler);

export default router;
