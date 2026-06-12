import express from "express";
import {
  createInvoiceHandler,
  deleteInvoiceHandler,
  getAllInvoicesHandler,
  getInvoiceByIdHandler,
  updateInvoiceHandler
} from "../controllers/invoice.controller.js";
import {
  ROLE_GROUPS,
  requireConfiguredRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/",
  requireConfiguredRoles(
    ...ROLE_GROUPS.executive,
    ...ROLE_GROUPS.finance,
    ...ROLE_GROUPS.commercial
  ),
  createInvoiceHandler
);
router.get("/", getAllInvoicesHandler);
router.get("/:id", getInvoiceByIdHandler);
router.put(
  "/:id",
  requireConfiguredRoles(
    ...ROLE_GROUPS.executive,
    ...ROLE_GROUPS.finance,
    ...ROLE_GROUPS.commercial
  ),
  updateInvoiceHandler
);
router.delete(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  deleteInvoiceHandler
);

export default router;
