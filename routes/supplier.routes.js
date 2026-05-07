import express from "express";
import {
  createSupplierHandler,
  getAllSuppliersHandler,
  getSupplierAccountStatementHandler,
  getSupplierByIdHandler,
  exportSupplierAccountStatementPdfHandler,
  updateSupplierHandler,
  deleteSupplierHandler
} from "../controllers/supplier.controller.js";

const router = express.Router();

router.post("/", createSupplierHandler);
router.get("/", getAllSuppliersHandler);
router.get("/:id/account-statement", getSupplierAccountStatementHandler);
router.get("/:id/account-statement.pdf", exportSupplierAccountStatementPdfHandler);
router.get("/:id", getSupplierByIdHandler);
router.put("/:id", updateSupplierHandler);
router.delete("/:id", deleteSupplierHandler);

export default router;
