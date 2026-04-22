import { pool } from "../../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaRetry
} from "../../utils/schemaSelfHealing.util.js";

function normalizeJson(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value;
}

async function ensureAIAgentRunsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS ai_agent_runs (
      id SERIAL PRIMARY KEY,
      run_key VARCHAR(100) NOT NULL UNIQUE,
      trigger_source VARCHAR(50) NOT NULL DEFAULT 'manual',
      trigger_label VARCHAR(150),
      orchestrator_name VARCHAR(100) NOT NULL DEFAULT 'ai_orchestrator',
      request_text TEXT,
      request_type VARCHAR(50) NOT NULL DEFAULT 'analysis',
      target_domain VARCHAR(50) NOT NULL DEFAULT 'general',
      invoked_agents JSONB NOT NULL DEFAULT '[]'::jsonb,
      context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      rules_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      knowledge_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary TEXT,
      result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      confidence_score NUMERIC(5,2),
      risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
      execution_mode VARCHAR(30) NOT NULL DEFAULT 'recommend_only',
      approval_state VARCHAR(30) NOT NULL DEFAULT 'not_required',
      status VARCHAR(30) NOT NULL DEFAULT 'completed',
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_agent_runs_trigger_source_chk CHECK (
        trigger_source IN ('manual', 'dashboard', 'scheduled', 'alert', 'api', 'system')
      ),
      CONSTRAINT ai_agent_runs_request_type_chk CHECK (
        request_type IN ('analysis', 'forecast', 'recommendation', 'scenario', 'decision_support', 'automation')
      ),
      CONSTRAINT ai_agent_runs_target_domain_chk CHECK (
        target_domain IN ('general', 'ceo', 'finance', 'accounting', 'commercial', 'marketing', 'operations', 'stock', 'production', 'knowledge')
      ),
      CONSTRAINT ai_agent_runs_risk_level_chk CHECK (
        risk_level IN ('low', 'medium', 'high', 'critical')
      ),
      CONSTRAINT ai_agent_runs_execution_mode_chk CHECK (
        execution_mode IN ('observe_only', 'recommend_only', 'draft_action', 'auto_execute_low_risk', 'approval_required')
      ),
      CONSTRAINT ai_agent_runs_approval_state_chk CHECK (
        approval_state IN ('not_required', 'pending', 'approved', 'rejected', 'expired')
      ),
      CONSTRAINT ai_agent_runs_status_chk CHECK (
        status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
      ),
      CONSTRAINT ai_agent_runs_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_trigger_source
      ON ai_agent_runs (trigger_source);

    CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_target_domain
      ON ai_agent_runs (target_domain);

    CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_status
      ON ai_agent_runs (status);

    CREATE INDEX IF NOT EXISTS idx_ai_agent_runs_started_at
      ON ai_agent_runs (started_at DESC);
  `;

  await ensureTableSchema({
    executor: (text) => pool.query(text),
    relationName: "ai_agent_runs",
    createSql: query
  });
}

async function queryWithAIAgentRunsSchemaRetry(query, values = []) {
  return queryWithSchemaRetry({
    executor: (text, params) => pool.query(text, params),
    ensureSchema: ensureAIAgentRunsTable,
    query,
    values
  });
}

export async function createAIAgentRun({
  run_key,
  trigger_source = "manual",
  trigger_label = null,
  orchestrator_name = "ai_orchestrator",
  request_text = null,
  request_type = "analysis",
  target_domain = "general",
  invoked_agents = [],
  context_snapshot = {},
  rules_snapshot = {},
  knowledge_snapshot = {},
  summary = null,
  result_payload = {},
  confidence_score = null,
  risk_level = "medium",
  execution_mode = "recommend_only",
  approval_state = "not_required",
  status = "completed",
  started_at = null,
  completed_at = null,
  created_by = null
}) {
  const query = `
    INSERT INTO ai_agent_runs (
      run_key,
      trigger_source,
      trigger_label,
      orchestrator_name,
      request_text,
      request_type,
      target_domain,
      invoked_agents,
      context_snapshot,
      rules_snapshot,
      knowledge_snapshot,
      summary,
      result_payload,
      confidence_score,
      risk_level,
      execution_mode,
      approval_state,
      status,
      started_at,
      completed_at,
      created_by
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,$14,$15,$16,$17,$18,
      COALESCE($19, NOW()),
      $20,
      $21
    )
    RETURNING *;
  `;

  const values = [
    run_key,
    trigger_source,
    trigger_label,
    orchestrator_name,
    request_text,
    request_type,
    target_domain,
    JSON.stringify(normalizeJson(invoked_agents, [])),
    JSON.stringify(normalizeJson(context_snapshot, {})),
    JSON.stringify(normalizeJson(rules_snapshot, {})),
    JSON.stringify(normalizeJson(knowledge_snapshot, {})),
    summary,
    JSON.stringify(normalizeJson(result_payload, {})),
    confidence_score,
    risk_level,
    execution_mode,
    approval_state,
    status,
    started_at,
    completed_at,
    created_by
  ];

  const result = await queryWithAIAgentRunsSchemaRetry(query, values);
  return result.rows[0];
}

export async function getRecentAIAgentRuns(limit = 20) {
  const query = `
    SELECT *
    FROM ai_agent_runs
    ORDER BY started_at DESC, id DESC
    LIMIT $1;
  `;

  const result = await queryWithAIAgentRunsSchemaRetry(query, [limit]);
  return result.rows;
}

export async function getAIAgentRunById(id) {
  const query = `
    SELECT *
    FROM ai_agent_runs
    WHERE id = $1
    LIMIT 1;
  `;

  const result = await queryWithAIAgentRunsSchemaRetry(query, [id]);
  return result.rows[0] || null;
}
