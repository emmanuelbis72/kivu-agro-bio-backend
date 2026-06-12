import express from "express";
import { runAnalyticsHandler } from "../controllers/analytics.controller.js";
import {
  ROLE_GROUPS,
  requireConfiguredAuthentication,
  requireConfiguredRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.get(
  "/run",
  requireConfiguredAuthentication,
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  runAnalyticsHandler
);
router.post(
  "/run",
  requireConfiguredAuthentication,
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  runAnalyticsHandler
);

export default router;
