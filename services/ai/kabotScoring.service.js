import { getBusinessRulesMap } from "./businessRules.service.js";
import { getCustomerScores } from "./customerScoring.service.js";
import { getProductScores } from "./productScoring.service.js";

function mapRiskLevel(level) {
  const normalized = String(level || "").toLowerCase();
  if (normalized === "critical") return "CRITICAL";
  if (normalized === "high") return "HIGH";
  if (normalized === "watch") return "MEDIUM";
  return "LOW";
}

export async function getCustomerRiskScoring() {
  const businessRules = await getBusinessRulesMap();
  const scores = await getCustomerScores(businessRules);

  return scores.map((row) => ({
    ...row,
    total_billed: row.total_sales_amount,
    total_paid: row.total_paid_amount,
    overdue_30_count: Number(row.overdue_invoices_count || 0),
    overdue_60_count:
      Number(row.max_days_overdue || 0) > 60
        ? Number(row.overdue_invoices_count || 0)
        : 0,
    risk_score: row.payment_risk_score,
    risk_level: mapRiskLevel(row.risk_level),
    recommendation: row.recommendation,
    practical_action: {
      owner_role: row.owner_role,
      deadline_days: row.deadline_days,
      first_step: row.first_step,
      target_collection_amount: row.target_collection_amount,
      credit_decision: row.credit_decision
    }
  }));
}

export async function getProductIntelligenceScoring() {
  const businessRules = await getBusinessRulesMap();
  const scores = await getProductScores(businessRules);

  return scores.map((row) => ({
    ...row,
    total_sales_value: row.total_sales_amount,
    has_stock_alert: Number(row.stock_alerts_count || 0) > 0,
    strategic_product: row.is_strategic,
    intelligence_level: mapRiskLevel(row.priority_level),
    recommendation: row.recommendation,
    practical_action: {
      owner_role: row.owner_role,
      deadline_days: row.deadline_days,
      first_step: row.first_step,
      recommended_reorder_quantity: row.recommended_reorder_quantity,
      success_metric: row.success_metric
    }
  }));
}
