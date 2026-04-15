import express from "express";
import {
  createAccountHandler,
  getAllAccountsHandler,
  getAccountByIdHandler,
  updateAccountHandler,
  deleteAccountHandler
} from "../controllers/account.controller.js";

const router = express.Router();

router.post("/", createAccountHandler);
router.get("/", getAllAccountsHandler);
router.get("/:id", getAccountByIdHandler);
router.put("/:id", updateAccountHandler);
router.delete("/:id", deleteAccountHandler);

export default router;