import express from "express";
import {
  createPurchaseInvoiceHandler,
  createSupplierPaymentHandler,
  deletePurchaseInvoiceHandler,
  getAllPurchaseInvoicesHandler,
  getPurchaseInvoiceByIdHandler,
  updatePurchaseInvoiceHandler
} from "../controllers/purchaseInvoice.controller.js";

const router = express.Router();

router.post("/", createPurchaseInvoiceHandler);
router.get("/", getAllPurchaseInvoicesHandler);
router.get("/:id", getPurchaseInvoiceByIdHandler);
router.put("/:id", updatePurchaseInvoiceHandler);
router.delete("/:id", deletePurchaseInvoiceHandler);
router.post("/:id/payments", createSupplierPaymentHandler);

export default router;
