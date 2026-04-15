import express from "express";
import {
  createExpenseHandler,
  getAllExpensesHandler,
  getExpenseByIdHandler,
  updateExpenseHandler,
  deleteExpenseHandler
} from "../controllers/expense.controller.js";

const router = express.Router();

router.post("/", createExpenseHandler);
router.get("/", getAllExpensesHandler);
router.get("/:id", getExpenseByIdHandler);
router.put("/:id", updateExpenseHandler);
router.delete("/:id", deleteExpenseHandler);

export default router;