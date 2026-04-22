import crypto from "crypto";

import {
  createAIAgentRun,
  getRecentAIAgentRuns
} from "../../models/ai/agentRun.model.js";
import {
  getAIAlerts,
  resolveAIAlert,
  upsertAIAlert
} from "../../models/ai/alert.model.js";
import {
  createAIRecommendation,
  decideAIRecommendation,
  getAIRecommendations
} from "../../models/ai/recommendation.model.js";
import { getKabotAlerts } from "./kabotAlerts.service.js";

function makeKey(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function mapIntentToDomain(intent) {
  switch (String(intent || "").toLowerCase()) {
    case "accounting_summary":
    case "accounting":
      return "accounting";
    case "cash_position_analysis":
    case "cash":
      return "finance";
    case "customer_receivables_risk":
    case "customers":
      return "commercial";
    case "stock_priority_restock":
    case "stock":
      return "stock";
    case "expense_pressure_analysis":
    case "expenses":
      return "finance";
    case "sales_overview":
    case "sales_variance_explanation":
      return "commercial";
    case "ai_reasoning":
    case "ai_ceo":
      return "ceo";
    default:
      return "general";
  }
}

function mapSeverityToImpact(severity) {
  const normalized = String(severity || "").toLowerCase();

  if (normalized === "critical") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

export async function persistAIQuestionRun({
  question,
  context = {},
  response,
  businessRules = {},
  createdBy = null
}) {
  const startedAt = new Date();
  const completedAt = new Date();

  return createAIAgentRun({
    run_key: makeKey("ai_run"),
    trigger_source: "manual",
    trigger_label: "api_ai_ask",
    orchestrator_name: "ai_orchestrator",
    request_text: question,
    request_type: "analysis",
    target_domain: mapIntentToDomain(response?.intent || response?.source_module),
    invoked_agents:
      response?.intent === "ai_reasoning"
        ? ["ai_orchestrator", "ceo_reasoning", "business_rules", "company_knowledge"]
        : ["ai_orchestrator"],
    context_snapshot: context,
    rules_snapshot: businessRules,
    knowledge_snapshot: {},
    summary: response?.summary || null,
    result_payload: response || {},
    confidence_score:
      response?.confidence_score !== undefined && response?.confidence_score !== null
        ? Number(response.confidence_score) * (Number(response.confidence_score) <= 1 ? 100 : 1)
        : null,
    risk_level: String(response?.priority_level || "medium").toLowerCase(),
    execution_mode: "recommend_only",
    approval_state: "not_required",
    status: "completed",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    created_by: createdBy
  });
}

export async function listPersistedAIRuns(limit = 20) {
  return getRecentAIAgentRuns(limit);
}

export async function syncKabotAlertsToStore() {
  const result = await getKabotAlerts();
  const alerts = Array.isArray(result?.alerts) ? result.alerts : [];
  const savedAlerts = [];

  for (const alert of alerts) {
    const saved = await upsertAIAlert({
      alert_key: String(alert.code || makeKey("alert")),
      source_agent: "kabot_alerts",
      domain: normalizeAlertDomain(alert.category),
      alert_type: String(alert.category || "general"),
      severity: String(alert.priority || "medium").toLowerCase(),
      priority_weight: Number(alert.priority_weight || 1),
      title: String(alert.title || "Alerte IA"),
      summary: String(alert.summary || ""),
      explanation: null,
      recommendation: alert.recommendation || null,
      entity_type: alert.entity_type || null,
      entity_id: alert.entity_id || null,
      object_ref: {
        entity_type: alert.entity_type || null,
        entity_id: alert.entity_id || null
      },
      alert_payload: alert,
      detected_at: alert.generated_at || null
    });

    savedAlerts.push(saved);
  }

  return {
    synced_count: savedAlerts.length,
    data: savedAlerts
  };
}

function normalizeAlertDomain(category) {
  const value = String(category || "").toLowerCase();

  if (["stock", "operations"].includes(value)) return "stock";
  if (["receivables", "sales", "customers"].includes(value)) return "commercial";
  if (["profitability", "cash", "expenses", "finance"].includes(value)) return "finance";
  return "general";
}

export async function listStoredAIAlerts({
  domain = null,
  severity = null,
  resolution_state = null,
  limit = 100
} = {}) {
  return getAIAlerts({ domain, severity, resolution_state, limit });
}

export async function resolveStoredAIAlert(id, options = {}) {
  return resolveAIAlert(id, options);
}

export async function createStoredAIRecommendation(payload) {
  return createAIRecommendation({
    recommendation_key: payload.recommendation_key || makeKey("recommendation"),
    ...payload
  });
}

export async function listStoredAIRecommendations({
  domain = null,
  decision_state = null,
  limit = 100
} = {}) {
  return getAIRecommendations({ domain, decision_state, limit });
}

export async function decideStoredAIRecommendation(id, options = {}) {
  return decideAIRecommendation(id, options);
}
