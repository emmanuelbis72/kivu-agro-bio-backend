import { getGlobalStats } from "../../models/dashboard.model.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function getCashScore(businessRules = {}) {
  const stats = await getGlobalStats();

  const totalCollected = Number(stats?.total_collected_amount || 0);
  const totalReceivables = Number(stats?.total_receivables || 0);
  const minimumCashThreshold = Number(
    businessRules?.minimum_cash_threshold_usd || 3000
  );

  let cashHealthScore = 100;

  if (totalCollected < minimumCashThreshold) {
    cashHealthScore -= 35;
  }

  if (totalReceivables > totalCollected && totalReceivables > 0) {
    cashHealthScore -= 25;
  }

  if (totalReceivables >= minimumCashThreshold) {
    cashHealthScore -= 15;
  }

  if (cashHealthScore < 0) {
    cashHealthScore = 0;
  }

  let status = "healthy";

  if (cashHealthScore < 70) status = "watch";
  if (cashHealthScore < 50) status = "critical";

  return {
    total_collected_amount: round2(totalCollected),
    total_receivables: round2(totalReceivables),
    minimum_cash_threshold_usd: round2(minimumCashThreshold),
    cash_health_score: cashHealthScore,
    status
  };
}