import express from "express";
import {
  createWarehouseHandler,
  getAllWarehousesHandler,
  getWarehouseByIdHandler,
  updateWarehouseHandler,
  deleteWarehouseHandler
} from "../controllers/warehouse.controller.js";

const router = express.Router();

router.post("/", createWarehouseHandler);
router.get("/", getAllWarehousesHandler);
router.get("/:id", getWarehouseByIdHandler);
router.put("/:id", updateWarehouseHandler);
router.delete("/:id", deleteWarehouseHandler);

export default router;