import express from "express";
import {
  bootstrapAdminHandler,
  loginHandler,
  meHandler
} from "../controllers/auth.controller.js";
import { requireAuthentication } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/bootstrap", bootstrapAdminHandler);
router.post("/login", loginHandler);
router.get("/me", requireAuthentication, meHandler);

export default router;
