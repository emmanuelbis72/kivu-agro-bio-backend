import { pool } from "../../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaRetry
} from "../../utils/schemaSelfHealing.util.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

async function ensureAIRecommendationsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS ai_recommendations (
      id SERIAL PRIMARY KEY,
      recommendation_key VARCHAR(120) NOT NULL UNIQUE,
      run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
      source_agent VARCHAR(100) NOT NULL,
      domain VARCHAR(50) NOT NULL,
      recommendation_type VARCHAR(80) NOT NULL,
      title VARCHAR(255) NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT,
      expected_impact VARCHAR(50) NOT NULL DEFAULT 'medium',
      urgency VARCHAR(20) NOT NULL DEFAULT 'medium',
      confidence_score NUMERIC(5,2),
      entity_type VARCHAR(50),
      entity_id INTEGER,
      action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      supporting_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      approval_requirement VARCHAR(30) NOT NULL DEFAULT 'approval_required',
      decision_state VARCHAR(30) NOT NULL DEFAULT 'proposed',
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMP,
      decision_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_recommendations_domain_chk CHECK (
        domain IN ('ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge', 'general')
      ),
      CONSTRAINT ai_recommendations_expected_impact_chk CHECK (
        expected_impact IN ('low', 'medium', 'high', 'critical')
      ),
      CONSTRAINT ai_recommendations_urgency_chk CHECK (
        urgency IN ('low', 'medium', 'high', 'critical')
      ),
      CONSTRAINT ai_recommendations_approval_requirement_chk CHECK (
        approval_requirement IN ('not_required', 'optional_review', 'approval_required')
      ),
      CONSTRAINT ai_recommendations_decision_state_chk CHECK (
        decision_state IN ('proposed', 'approved', 'rejected', 'deferred', 'executed', 'expired')
      ),
      CONSTRAINT ai_recommendations_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_ai_recommendations_domain
      ON ai_recommendations (domain);

    CREATE INDEX IF NOT EXISTS idx_ai_recommendations_decision_state
      ON ai_recommendations (decision_state);

    CREATE INDEX IF NOT EXISTS idx_ai_recommendations_urgency
      ON ai_recommendations (urgency);

    CREATE INDEX IF NOT EXISTS idx_ai_recommendations_entity
      ON ai_recommendations (entity_type, entity_id);

    CREATE INDEX IF NOT EXISTS idx_ai_recommendations_created_at
      ON ai_recommendations (created_at DESC);
  `;

  await ensureTableSchema({
    executor: (text) => pool.query(text),
    relationName: "ai_recommendations",
    createSql: query
  });
}

async function queryWithAIRecommendationsSchemaRetry(query, values = []) {
  return queryWithSchemaRetry({
    executor: (text, params) => pool.query(text, params),
    ensureSchema: ensureAIRecommendationsTable,
    query,
    values
  });
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

  const result = await queryWithAIRecommendationsSchemaRetry(query, [
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

  const result = await queryWithAIRecommendationsSchemaRetry(query, values);
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

  const result = await queryWithAIRecommendationsSchemaRetry(query, [
    id,
    decision_state,
    decided_by,
    decision_notes
  ]);

  return result.rows[0] || null;
}
