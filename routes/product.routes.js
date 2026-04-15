import express from "express";
import {
  createProductHandler,
  getAllProductsHandler,
  getProductByIdHandler,
  updateProductHandler,
  deleteProductHandler
} from "../controllers/product.controller.js";

const router = express.Router();

router.post("/", createProductHandler);
router.get("/", getAllProductsHandler);
router.get("/:id", getProductByIdHandler);
router.put("/:id", updateProductHandler);
router.delete("/:id", deleteProductHandler);

export default router;