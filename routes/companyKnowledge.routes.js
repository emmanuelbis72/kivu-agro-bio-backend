import express from "express";
import {
  getCompanyKnowledgeListHandler,
  getCompanyKnowledgeByKeyHandler,
  upsertCompanyKnowledgeHandler,
  deactivateCompanyKnowledgeHandler,
  searchCompanyKnowledgeHandler,
  seedCompanyKnowledgeHandler
} from "../controllers/companyKnowledge.controller.js";

const router = express.Router();

/* ================= COMPANY KNOWLEDGE ================= */
router.get("/", getCompanyKnowledgeListHandler);
router.get("/search", searchCompanyKnowledgeHandler);
router.post("/seed", seedCompanyKnowledgeHandler);
router.get("/:knowledgeKey", getCompanyKnowledgeByKeyHandler);
router.post("/", upsertCompanyKnowledgeHandler);
router.put("/:knowledgeKey", upsertCompanyKnowledgeHandler);
router.delete("/:knowledgeKey", deactivateCompanyKnowledgeHandler);

export default router;