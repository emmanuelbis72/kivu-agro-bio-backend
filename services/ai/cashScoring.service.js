import {
  getCashForecast,
  getGlobalStats
} from "../../models/dashboard.model.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export async function getCashScore(businessRules = {}) {
  const [forecast, globalStats] = await Promise.all([
    getCashForecast(10),
    getGlobalStats()
  ]);
  const summary = forecast.summary || {};
  const currentCash = Number(summary.current_cash_base || 0);
  const openReceivables = Number(summary.open_receivables || 0);
  const overdueReceivables = Number(summary.overdue_receivables || 0);
  const openPayables = Number(summary.open_payables || 0);
  const minimumCashThreshold = Number(
    businessRules?.minimum_cash_threshold_usd || 3000
  );
  const overdueShare =
    openReceivables > 0 ? overdueReceivables / openReceivables : 0;
  const negativeTreasuryChannels = [
    ["bank", Number(summary.bank_base || 0)],
    ["mobile_money", Number(summary.mobile_money_base || 0)],
    ["other", Number(summary.other_treasury_base || 0)]
  ].filter(([, amount]) => amount < 0);

  let cashHealthScore = 100;

  if (currentCash < minimumCashThreshold) cashHealthScore -= 45;
  else if (currentCash < minimumCashThreshold * 2) cashHealthScore -= 20;

  cashHealthScore -= Math.min(25, overdueShare * 25);

  if (openPayables > currentCash) cashHealthScore -= 20;
  cashHealthScore -= Math.min(15, negativeTreasuryChannels.length * 5);
  cashHealthScore = Math.max(0, Math.round(cashHealthScore));

  const status =
    cashHealthScore < 50
      ? "critical"
      : cashHealthScore < 80
        ? "watch"
        : "healthy";
  const horizon7 = (forecast.horizons || []).find(
    (row) => Number(row.horizon_days) === 7
  );

  return {
    total_collected_amount: round2(globalStats?.total_collected_amount),
    total_receivables: round2(openReceivables),
    current_cash_base: round2(currentCash),
    cash_on_hand_base: round2(summary.cash_on_hand_base),
    bank_base: round2(summary.bank_base),
    mobile_money_base: round2(summary.mobile_money_base),
    open_receivables: round2(openReceivables),
    overdue_receivables: round2(overdueReceivables),
    overdue_receivables_percent: round2(overdueShare * 100),
    open_payables: round2(openPayables),
    projected_balance_7d: round2(horizon7?.projected_balance),
    expected_inflows_7d: round2(horizon7?.expected_inflows),
    minimum_cash_threshold_usd: round2(minimumCashThreshold),
    cash_health_score: cashHealthScore,
    status,
    negative_treasury_channels: negativeTreasuryChannels.map(
      ([channel, amount]) => ({ channel, amount: round2(amount) })
    ),
    explanation:
      `Tresorerie disponible ${round2(currentCash)} USD; creances echues ${round2(overdueReceivables)} USD ` +
      `(${round2(overdueShare * 100)} % des creances ouvertes); projection J+7 ${round2(horizon7?.projected_balance)} USD.`,
    owner_role: "Direction financiere",
    deadline_days:
      status === "critical" || negativeTreasuryChannels.length > 0
        ? 0
        : status === "watch"
          ? 3
          : 7,
    recommendation:
      overdueReceivables > 0
        ? `Convertir en priorite les ${round2(overdueReceivables)} USD de creances echues en encaissements reels; ne pas traiter les creances comme du cash disponible.`
        : "Maintenir la discipline d'encaissement et suivre les soldes de tresorerie par canal.",
    first_step:
      negativeTreasuryChannels.length > 0
        ? `Rapprocher aujourd'hui les soldes negatifs: ${negativeTreasuryChannels
            .map(([channel, amount]) => `${channel} ${round2(amount)} USD`)
            .join(", ")}.`
        : "Verifier les encaissements attendus a 7 jours.",
    success_metric:
      "Solde de chaque canal rapproche et plan d'encaissement date sur les creances echues."
  };
}
