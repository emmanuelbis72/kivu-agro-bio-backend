import express from "express";
import {
  createCustomerHandler,
  getAllCustomersHandler,
  getCustomerAccountStatementHandler,
  getCustomerByIdHandler,
  updateCustomerHandler,
  deleteCustomerHandler
} from "../controllers/customer.controller.js";

const router = express.Router();

router.post("/", createCustomerHandler);
router.get("/", getAllCustomersHandler);
router.get("/:id/account-statement", getCustomerAccountStatementHandler);
router.get("/:id", getCustomerByIdHandler);
router.put("/:id", updateCustomerHandler);
router.delete("/:id", deleteCustomerHandler);

export default router;
