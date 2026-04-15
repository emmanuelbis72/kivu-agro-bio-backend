import express from "express";
import {
  createInvoiceHandler,
  getAllInvoicesHandler,
  getInvoiceByIdHandler
} from "../controllers/invoice.controller.js";

const router = express.Router();

router.post("/", createInvoiceHandler);
router.get("/", getAllInvoicesHandler);
router.get("/:id", getInvoiceByIdHandler);

export default router;