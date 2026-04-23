import express from "express";
import {
  createInvoiceHandler,
  deleteInvoiceHandler,
  getAllInvoicesHandler,
  getInvoiceByIdHandler,
  updateInvoiceHandler
} from "../controllers/invoice.controller.js";

const router = express.Router();

router.post("/", createInvoiceHandler);
router.get("/", getAllInvoicesHandler);
router.get("/:id", getInvoiceByIdHandler);
router.put("/:id", updateInvoiceHandler);
router.delete("/:id", deleteInvoiceHandler);

export default router;
