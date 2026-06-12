import express from "express";
import {
  createProductHandler,
  getAllProductsHandler,
  getProductByIdHandler,
  updateProductHandler,
  deleteProductHandler
} from "../controllers/product.controller.js";
import {
  ROLE_GROUPS,
  requireConfiguredRoles
} from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post(
  "/",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.operations),
  createProductHandler
);
router.get("/", getAllProductsHandler);
router.get("/:id", getProductByIdHandler);
router.put(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive, ...ROLE_GROUPS.operations),
  updateProductHandler
);
router.delete(
  "/:id",
  requireConfiguredRoles(...ROLE_GROUPS.executive),
  deleteProductHandler
);

export default router;
