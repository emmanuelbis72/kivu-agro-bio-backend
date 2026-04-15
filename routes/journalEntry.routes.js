import express from "express";
import {
  createJournalEntryHandler,
  getAllJournalEntriesHandler,
  getJournalEntryByIdHandler,
  postJournalEntryHandler
} from "../controllers/journalEntry.controller.js";

const router = express.Router();

router.post("/", createJournalEntryHandler);
router.get("/", getAllJournalEntriesHandler);
router.get("/:id", getJournalEntryByIdHandler);
router.post("/:id/post", postJournalEntryHandler);

export default router;