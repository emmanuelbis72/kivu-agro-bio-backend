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
import {
  ROLE_GROUPS,
  requireConfiguredRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.commercial),
  createCustomerHandler
);
router.get("/", getAllCustomersHandler);
router.put(
  "/bulk-commercial",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.commercial),
  bulkAssignCustomerCommercialHandler
);
router.get("/:id/account-statement", getCustomerAccountStatementHandler);
router.get("/:id/account-statement.pdf", exportCustomerAccountStatementPdfHandler);
router.get("/:id", getCustomerByIdHandler);
router.put(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.commercial),
  updateCustomerHandler
);
router.delete(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  deleteCustomerHandler
);

export default router;
