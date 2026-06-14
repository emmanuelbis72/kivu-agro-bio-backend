import { getBusinessRulesMap } from "./businessRules.service.js";
import { getCustomerScores } from "./customerScoring.service.js";
import {
  getLatestCustomerScores,
  upsertCustomerScore
} from "../../models/ai/customerScore.model.js";

function enrichPersistedScore(row) {
  const payload =
    row?.score_payload && typeof row.score_payload === "object"
      ? row.score_payload
      : {};

  return {
    ...row,
    ...payload,
    score_id: row.id,
    score_date: row.score_date,
    source_agent: row.source_agent,
    customer_segment: row.customer_segment,
    churn_risk_score: Number(row.churn_risk_score || 0),
    upsell_potential_score: Number(row.upsell_potential_score || 0),
    payment_risk_score: Number(row.payment_risk_score || 0),
    strategic_value_score: Number(row.strategic_value_score || 0),
    collection_priority_score: Number(row.collection_priority_score || 0),
    practical_action: {
      owner_role: payload.owner_role || "Finance / Recouvrement",
      deadline_days: Number(payload.deadline_days || 0),
      first_step: payload.first_step || null,
      target_collection_amount: Number(
        payload.target_collection_amount || 0
      ),
      credit_decision: payload.credit_decision || null,
      success_metric:
        payload.target_collection_amount > 0
          ? `Paiement ou engagement date sur ${payload.target_collection_amount} USD.`
          : null
    }
  };
}

function inferSegment(row) {
  const sales = Number(row.total_sales_amount || 0);
  const receivable = Number(row.total_balance_due || 0);

  if (sales >= 5000 && receivable <= 500) {
    return "key_account";
  }

  if (receivable >= 1000) {
    return "collection_watch";
  }

  if (sales <= 1000) {
    return "growth_potential";
  }

  return "standard";
}

function inferChurnRisk(row) {
  const sales = Number(row.total_sales_amount || 0);
  const valueScore = Number(row.customer_value_score || 0);

  if (sales <= 500 && valueScore <= 25) {
    return 65;
  }

  if (sales <= 1000) {
    return 45;
  }

  return 20;
}

function inferUpsellPotential(row) {
  const valueScore = Number(row.customer_value_score || 0);
  const receivable = Number(row.total_balance_due || 0);

  let score = valueScore;

  if (receivable > 1000) {
    score -= 20;
  } else if (receivable > 0) {
    score -= 10;
  }

  if (row.is_priority_city) {
    score += 10;
  }

  if (row.is_priority_channel) {
    score += 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function syncCustomerScoresSnapshot(scoreDate = new Date().toISOString().slice(0, 10)) {
  const businessRules = await getBusinessRulesMap();
  const scores = await getCustomerScores(businessRules);
  const persisted = [];

  for (const row of scores) {
    const paymentRiskScore = Math.max(
      0,
      Math.min(100, Math.round(Number(row.customer_risk_score || 0)))
    );
    const strategicValueScore = Math.max(
      0,
      Math.min(100, Math.round(Number(row.customer_value_score || 0)))
    );
    const churnRiskScore = inferChurnRisk(row);
    const upsellPotentialScore = inferUpsellPotential(row);
    const collectionPriorityScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Number(
            row.collection_priority_score ??
              (Number(row.total_balance_due || 0) > 0
                ? paymentRiskScore
                : paymentRiskScore * 0.6)
          )
        )
      )
    );

    const saved = await upsertCustomerScore({
      customer_id: row.customer_id,
      score_date: scoreDate,
      source_agent: "customer_scoring",
      payment_risk_score: paymentRiskScore,
      strategic_value_score: strategicValueScore,
      churn_risk_score: churnRiskScore,
      upsell_potential_score: upsellPotentialScore,
      collection_priority_score: collectionPriorityScore,
      customer_segment: inferSegment(row),
      score_payload: row,
      explanation: row.explanation ||
        "Score explique par l'exposition, le retard, le comportement de paiement et la valeur commerciale."
    });

    persisted.push(enrichPersistedScore(saved));
  }

  return persisted;
}

export async function getLatestPersistedCustomerScores(limit = 100) {
  const rows = await getLatestCustomerScores(limit);
  return rows.map(enrichPersistedScore);
}
