import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant dans les variables d'environnement.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

export async function connectDB() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW() AS current_time");
    console.log("✅ PostgreSQL connecté :", result.rows[0].current_time);
  } finally {
    client.release();
  }
}
