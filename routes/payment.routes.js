import express from "express";
import {
  allocateUnallocatedPaymentHandler,
  createPaymentHandler,
  getPaymentsByInvoiceIdHandler,
  getUnallocatedPaymentsHandler,
  updateUnallocatedPaymentHandler
} from "../controllers/payment.controller.js";

const router = express.Router();

router.get("/unallocated", getUnallocatedPaymentsHandler);
router.put("/unallocated/:id", updateUnallocatedPaymentHandler);
router.post("/unallocated/:id/allocate", allocateUnallocatedPaymentHandler);
router.post("/", createPaymentHandler);
router.get("/invoice/:invoiceId", getPaymentsByInvoiceIdHandler);

export default router;
