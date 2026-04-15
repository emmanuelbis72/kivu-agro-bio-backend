import express from "express";
import {
  createPaymentHandler,
  getPaymentsByInvoiceIdHandler
} from "../controllers/payment.controller.js";

const router = express.Router();

router.post("/", createPaymentHandler);
router.get("/invoice/:invoiceId", getPaymentsByInvoiceIdHandler);

export default router;