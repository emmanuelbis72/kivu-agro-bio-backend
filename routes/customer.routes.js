import express from "express";
import {
  bulkAssignCustomerCommercialHandler,
  createCustomerHandler,
  getAllCustomersHandler,
  getCustomerAccountStatementHandler,
  getCustomerByIdHandler,
  exportCustomerAccountStatementPdfHandler,
  updateCustomerHandler,
  deleteCustomerHandler
} from "../controllers/customer.controller.js";

const router = express.Router();

router.post("/", createCustomerHandler);
router.get("/", getAllCustomersHandler);
router.put("/bulk-commercial", bulkAssignCustomerCommercialHandler);
router.get("/:id/account-statement", getCustomerAccountStatementHandler);
router.get("/:id/account-statement.pdf", exportCustomerAccountStatementPdfHandler);
router.get("/:id", getCustomerByIdHandler);
router.put("/:id", updateCustomerHandler);
router.delete("/:id", deleteCustomerHandler);

export default router;
