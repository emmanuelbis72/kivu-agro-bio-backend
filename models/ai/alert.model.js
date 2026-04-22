import { pool } from "../../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaRetry
} from "../../utils/schemaSelfHealing.util.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

async function ensureAIAlertsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS ai_alerts (
      id SERIAL PRIMARY KEY,
      alert_key VARCHAR(120) NOT NULL UNIQUE,
      run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
      source_agent VARCHAR(100) NOT NULL,
      domain VARCHAR(50) NOT NULL,
      alert_type VARCHAR(60) NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'medium',
      priority_weight INTEGER NOT NULL DEFAULT 1,
      title VARCHAR(255) NOT NULL,
      summary TEXT NOT NULL,
      explanation TEXT,
      recommendation TEXT,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      object_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
      alert_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
      resolution_state VARCHAR(30) NOT NULL DEFAULT 'open',
      resolved_at TIMESTAMP,
      resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolution_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_alerts_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge', 'general')
      ),
      CONSTRAINT ai_alerts_severity_chk CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
      ),
      CONSTRAINT ai_alerts_priority_weight_chk CHECK (
        priority_weight >= 1 AND priority_weight <= 10
      ),
      CONSTRAINT ai_alerts_resolution_state_chk CHECK (
        resolution_state IN ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed')
      )
    );

    CREATE INDEX IF NOT EXISTS idx_ai_alerts_domain
      ON ai_alerts (domain);

    CREATE INDEX IF NOT EXISTS idx_ai_alerts_severity
      ON ai_alerts (severity);

    CREATE INDEX IF NOT EXISTS idx_ai_alerts_resolution_state
      ON ai_alerts (resolution_state);

    CREATE INDEX IF NOT EXISTS idx_ai_alerts_detected_at
      ON ai_alerts (detected_at DESC);

    CREATE INDEX IF NOT EXISTS idx_ai_alerts_entity
      ON ai_alerts (entity_type, entity_id);
  `;

  await ensureTableSchema({
    executor: (text) => pool.query(text),
    relationName: "ai_alerts",
    createSql: query
  });
}

async function queryWithAIAlertsSchemaRetry(query, values = []) {
  return queryWithSchemaRetry({
    executor: (text, params) => pool.query(text, params),
    ensureSchema: ensureAIAlertsTable,
    query,
    values
  });
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

  const result = await queryWithAIAlertsSchemaRetry(query, [
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

  const result = await queryWithAIAlertsSchemaRetry(query, values);
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

  const result = await queryWithAIAlertsSchemaRetry(query, [
    id,
    resolved_by,
    resolution_notes
  ]);
  return result.rows[0] || null;
}
