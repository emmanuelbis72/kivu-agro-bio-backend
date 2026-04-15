import express from "express";
import { pool } from "../config/db.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT NOW() AS server_time");

    res.status(200).json({
      success: true,
      message: "API KIVU AGRO BIO opérationnelle",
      database: "connected",
      serverTime: result.rows[0].server_time
    });
  } catch (error) {
    next(error);
  }
});

export default router;
