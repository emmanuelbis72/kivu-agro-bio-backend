import express from "express";
import {
  createBudgetHandler,
  deleteBudgetHandler,
  exportBudgetVsActualHandler,
  getAllBudgetsHandler,
  getBudgetByIdHandler,
  getBudgetCategoriesHandler,
  getBudgetVsActualHandler,
  updateBudgetHandler
} from "../controllers/budget.controller.js";

const router = express.Router();

router.get("/categories", getBudgetCategoriesHandler);
router.get("/", getAllBudgetsHandler);
router.post("/", createBudgetHandler);
router.get("/:id", getBudgetByIdHandler);
router.put("/:id", updateBudgetHandler);
router.delete("/:id", deleteBudgetHandler);
router.get("/:id/vs-actual", getBudgetVsActualHandler);
router.get("/:id/export/:format", exportBudgetVsActualHandler);

export default router;
