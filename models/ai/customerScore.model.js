import { pool } from "../../config/db.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
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

  const result = await pool.query(query, [
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

  const result = await pool.query(query, [limit]);
  return result.rows;
}
