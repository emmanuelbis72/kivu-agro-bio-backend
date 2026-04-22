import { pool } from "../../config/db.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

export async function createAIRecommendation({
  recommendation_key,
  run_id = null,
  source_agent,
  domain,
  recommendation_type,
  title,
  summary,
  rationale = null,
  expected_impact = "medium",
  urgency = "medium",
  confidence_score = null,
  entity_type = null,
  entity_id = null,
  action_payload = {},
  supporting_metrics = {},
  approval_requirement = "approval_required"
}) {
  const query = `
    INSERT INTO ai_recommendations (
      recommendation_key,
      run_id,
      source_agent,
      domain,
      recommendation_type,
      title,
      summary,
      rationale,
      expected_impact,
      urgency,
      confidence_score,
      entity_type,
      entity_id,
      action_payload,
      supporting_metrics,
      approval_requirement
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16
    )
    RETURNING *;
  `;

  const result = await pool.query(query, [
    recommendation_key,
    run_id,
    source_agent,
    domain,
    recommendation_type,
    title,
    summary,
    rationale,
    expected_impact,
    urgency,
    confidence_score,
    entity_type,
    entity_id,
    toJson(action_payload),
    toJson(supporting_metrics),
    approval_requirement
  ]);

  return result.rows[0];
}

export async function getAIRecommendations({
  domain = null,
  decision_state = null,
  limit = 100
} = {}) {
  const conditions = [];
  const values = [];

  if (domain) {
    values.push(domain);
    conditions.push(`domain = $${values.length}`);
  }

  if (decision_state) {
    values.push(decision_state);
    conditions.push(`decision_state = $${values.length}`);
  }

  values.push(limit);

  const query = `
    SELECT *
    FROM ai_recommendations
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function decideAIRecommendation(
  id,
  { decision_state, decided_by = null, decision_notes = null } = {}
) {
  const query = `
    UPDATE ai_recommendations
    SET
      decision_state = $2,
      decided_by = $3,
      decided_at = NOW(),
      decision_notes = $4,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [
    id,
    decision_state,
    decided_by,
    decision_notes
  ]);

  return result.rows[0] || null;
}
