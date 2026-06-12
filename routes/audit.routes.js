import express from "express";
import { listAuditLogsHandler } from "../controllers/audit.controller.js";
import {
  ROLE_GROUPS,
  requireAuthentication,
  requireRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/",
  requireAuthentication,
  requireRoles(...ROLE_GROUPS.executive, "accountant"),
  listAuditLogsHandler
);

export default router;
