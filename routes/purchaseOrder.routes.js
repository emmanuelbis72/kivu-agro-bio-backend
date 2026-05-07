import express from "express";
import {
  createPurchaseOrderHandler,
  deletePurchaseOrderHandler,
  getAllPurchaseOrdersHandler,
  getPurchaseOrderByIdHandler,
  receivePurchaseOrderHandler,
  updatePurchaseOrderHandler
} from "../controllers/purchaseOrder.controller.js";

const router = express.Router();

router.post("/", createPurchaseOrderHandler);
router.get("/", getAllPurchaseOrdersHandler);
router.get("/:id", getPurchaseOrderByIdHandler);
router.put("/:id", updatePurchaseOrderHandler);
router.delete("/:id", deletePurchaseOrderHandler);
router.post("/:id/receive", receivePurchaseOrderHandler);

export default router;
