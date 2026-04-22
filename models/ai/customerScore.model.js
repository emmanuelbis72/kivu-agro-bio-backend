import { pool } from "../../config/db.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

function isUndefinedTableError(error) {
  return error?.code === "42P01";
}

function isConcurrentCreateError(error, relationName) {
  const message = String(error?.message || "");
  const detail = String(error?.detail || "");

  return (
    error?.code === "42P07" ||
    (error?.code === "23505" &&
      (message.includes(relationName) || detail.includes(relationName)))
  );
}

async function ensureCustomerScoresTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS customer_scores (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      score_date DATE NOT NULL DEFAULT CURRENT_DATE,
      source_agent VARCHAR(100) NOT NULL DEFAULT 'customer_scoring',
      payment_risk_score NUMERIC(5,2),
      strategic_value_score NUMERIC(5,2),
      churn_risk_score NUMERIC(5,2),
      upsell_potential_score NUMERIC(5,2),
      collection_priority_score NUMERIC(5,2),
      customer_segment VARCHAR(50),
      score_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      explanation TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT customer_scores_payment_risk_chk CHECK (
        payment_risk_score IS NULL OR (payment_risk_score >= 0 AND payment_risk_score <= 100)
      ),
      CONSTRAINT customer_scores_strategic_value_chk CHECK (
        strategic_value_score IS NULL OR (strategic_value_score >= 0 AND strategic_value_score <= 100)
      ),
      CONSTRAINT customer_scores_churn_risk_chk CHECK (
        churn_risk_score IS NULL OR (churn_risk_score >= 0 AND churn_risk_score <= 100)
      ),
      CONSTRAINT customer_scores_upsell_potential_chk CHECK (
        upsell_potential_score IS NULL OR (upsell_potential_score >= 0 AND upsell_potential_score <= 100)
      ),
      CONSTRAINT customer_scores_collection_priority_chk CHECK (
        collection_priority_score IS NULL OR (collection_priority_score >= 0 AND collection_priority_score <= 100)
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_scores_customer_day
      ON customer_scores (customer_id, score_date);

    CREATE INDEX IF NOT EXISTS idx_customer_scores_score_date
      ON customer_scores (score_date DESC);
  `;

  try {
    await pool.query(query);
  } catch (error) {
    if (!isConcurrentCreateError(error, "customer_scores")) {
      throw error;
    }
  }
}

async function queryWithCustomerScoresSchemaRetry(query, values = []) {
  try {
    return await pool.query(query, values);
  } catch (error) {
    if (!isUndefinedTableError(error)) {
      throw error;
    }

    await ensureCustomerScoresTable();
    return pool.query(query, values);
  }
}

export async function upsertCustomerScore({
  customer_id,
  score_date,
  source_agent = "customer_scoring",
  payment_risk_score = null,
  strategic_value_score = null,
  churn_risk_score = null,
  upsell_potential_score = null,
  collection_priority_score = null,
  customer_segment = null,
  score_payload = {},
  explanation = null
}) {
  const query = `
    INSERT INTO customer_scores (
      customer_id,
      score_date,
      source_agent,
      payment_risk_score,
      strategic_value_score,
      churn_risk_score,
      upsell_potential_score,
      collection_priority_score,
      customer_segment,
      score_payload,
      explanation
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
    ON CONFLICT (customer_id, score_date)
    DO UPDATE SET
      source_agent = EXCLUDED.source_agent,
      payment_risk_score = EXCLUDED.payment_risk_score,
      strategic_value_score = EXCLUDED.strategic_value_score,
      churn_risk_score = EXCLUDED.churn_risk_score,
      upsell_potential_score = EXCLUDED.upsell_potential_score,
      collection_priority_score = EXCLUDED.collection_priority_score,
      customer_segment = EXCLUDED.customer_segment,
      score_payload = EXCLUDED.score_payload,
      explanation = EXCLUDED.explanation,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await queryWithCustomerScoresSchemaRetry(query, [
    customer_id,
    score_date,
    source_agent,
    payment_risk_score,
    strategic_value_score,
    churn_risk_score,
    upsell_potential_score,
    collection_priority_score,
    customer_segment,
    toJson(score_payload),
    explanation
  ]);

  return result.rows[0];
}

export async function getLatestCustomerScores(limit = 100) {
  const query = `
    WITH latest_score_dates AS (
      SELECT customer_id, MAX(score_date) AS latest_score_date
      FROM customer_scores
      GROUP BY customer_id
    )
    SELECT
      cs.*,
      c.business_name,
      c.city
    FROM customer_scores cs
    INNER JOIN latest_score_dates lsd
      ON lsd.customer_id = cs.customer_id
     AND lsd.latest_score_date = cs.score_date
    INNER JOIN customers c ON c.id = cs.customer_id
    ORDER BY cs.payment_risk_score DESC NULLS LAST, cs.collection_priority_score DESC NULLS LAST, c.business_name ASC
    LIMIT $1;
  `;

  const result = await queryWithCustomerScoresSchemaRetry(query, [limit]);
  return result.rows;
}
