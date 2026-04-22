import { pool } from "../../config/db.js";

function normalizeJson(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value;
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

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function getRecentAIAgentRuns(limit = 20) {
  const query = `
    SELECT *
    FROM ai_agent_runs
    ORDER BY started_at DESC, id DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

export async function getAIAgentRunById(id) {
  const query = `
    SELECT *
    FROM ai_agent_runs
    WHERE id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [id]);
  return result.rows[0] || null;
}
