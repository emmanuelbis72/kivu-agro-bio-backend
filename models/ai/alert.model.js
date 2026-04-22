import { pool } from "../../config/db.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

export async function upsertAIAlert({
  alert_key,
  run_id = null,
  source_agent,
  domain,
  alert_type,
  severity = "medium",
  priority_weight = 1,
  title,
  summary,
  explanation = null,
  recommendation = null,
  entity_type = null,
  entity_id = null,
  object_ref = {},
  alert_payload = {},
  detected_at = null
}) {
  const query = `
    INSERT INTO ai_alerts (
      alert_key,
      run_id,
      source_agent,
      domain,
      alert_type,
      severity,
      priority_weight,
      title,
      summary,
      explanation,
      recommendation,
      entity_type,
      entity_id,
      object_ref,
      alert_payload,
      detected_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,COALESCE($16, NOW())
    )
    ON CONFLICT (alert_key)
    DO UPDATE SET
      run_id = EXCLUDED.run_id,
      source_agent = EXCLUDED.source_agent,
      domain = EXCLUDED.domain,
      alert_type = EXCLUDED.alert_type,
      severity = EXCLUDED.severity,
      priority_weight = EXCLUDED.priority_weight,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      explanation = EXCLUDED.explanation,
      recommendation = EXCLUDED.recommendation,
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      object_ref = EXCLUDED.object_ref,
      alert_payload = EXCLUDED.alert_payload,
      detected_at = EXCLUDED.detected_at,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await pool.query(query, [
    alert_key,
    run_id,
    source_agent,
    domain,
    alert_type,
    severity,
    priority_weight,
    title,
    summary,
    explanation,
    recommendation,
    entity_type,
    entity_id,
    toJson(object_ref),
    toJson(alert_payload),
    detected_at
  ]);

  return result.rows[0];
}

export async function getAIAlerts({
  domain = null,
  severity = null,
  resolution_state = null,
  limit = 100
} = {}) {
  const conditions = [];
  const values = [];

  if (domain) {
    values.push(domain);
    conditions.push(`domain = $${values.length}`);
  }

  if (severity) {
    values.push(severity);
    conditions.push(`severity = $${values.length}`);
  }

  if (resolution_state) {
    values.push(resolution_state);
    conditions.push(`resolution_state = $${values.length}`);
  }

  values.push(limit);

  const query = `
    SELECT *
    FROM ai_alerts
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY priority_weight DESC, detected_at DESC, id DESC
    LIMIT $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function resolveAIAlert(id, { resolved_by = null, resolution_notes = null } = {}) {
  const query = `
    UPDATE ai_alerts
    SET
      resolution_state = 'resolved',
      resolved_at = NOW(),
      resolved_by = $2,
      resolution_notes = $3,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [id, resolved_by, resolution_notes]);
  return result.rows[0] || null;
}
