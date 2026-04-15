import express from "express";
import { downloadInvoicePdfHandler } from "../controllers/invoicePdf.controller.js";

const router = express.Router();

router.get("/:id/pdf", downloadInvoicePdfHandler);

export default router;