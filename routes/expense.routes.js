import express from "express";
import {
  createExpenseHandler,
  getAllExpensesHandler,
  getExpenseByIdHandler,
  updateExpenseHandler,
  deleteExpenseHandler
} from "../controllers/expense.controller.js";
import {
  ROLE_GROUPS,
  requireConfiguredRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  createExpenseHandler
);
router.get("/", getAllExpensesHandler);
router.get("/:id", getExpenseByIdHandler);
router.put(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  updateExpenseHandler
);
router.delete(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.finance),
  deleteExpenseHandler
);

export default router;
