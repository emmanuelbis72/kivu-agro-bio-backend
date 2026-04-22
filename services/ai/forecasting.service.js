import { getBusinessRulesMap } from "./businessRules.service.js";
import {
  getGlobalStats,
  getSalesOverview,
  getStockAlerts
} from "../../models/dashboard.model.js";
import { getAllInvoices } from "../../models/invoice.model.js";
import { getAIForecasts, upsertAIForecast } from "../../models/ai/forecast.model.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function average(numbers = []) {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + Number(value || 0), 0) / numbers.length;
}

function buildScenarioValue(baseValue, factor) {
  return round2(Number(baseValue || 0) * factor);
}

export async function syncAIForecasts() {
  const businessRules = await getBusinessRulesMap();
  const [globalStats, salesOverview, stockAlerts, invoices] = await Promise.all([
    getGlobalStats(),
    getSalesOverview(),
    getStockAlerts(),
    getAllInvoices()
  ]);

  const horizonStart = todayDateString();
  const horizonEnd = addDays(horizonStart, 30);

  const recentPeriods = Array.isArray(salesOverview)
    ? salesOverview.slice(-3)
    : [];

  const averageMonthlySales = average(
    recentPeriods.map((row) => Number(row.total_sales || 0))
  );
  const averageMonthlyCollected = average(
    recentPeriods.map((row) => Number(row.total_collected || 0))
  );

  const currentReceivables = Number(globalStats?.total_receivables || 0);
  const currentStockAlerts = Number(stockAlerts?.length || 0);
  const overdueInvoices = invoices.filter(
    (invoice) => Number(invoice.balance_due || 0) > 0
  ).length;
  const cashThreshold = Number(
    businessRules?.minimum_cash_threshold_usd || 3000
  );

  const definitions = [
    {
      key: "sales_30d_baseline",
      forecast_domain: "sales",
      forecast_type: "sales_run_rate_30d",
      scenario_label: "baseline",
      projected_value: averageMonthlySales,
      projected_unit: "USD",
      explanation: "Projection 30 jours basee sur la moyenne des 3 dernieres periodes disponibles.",
      forecast_payload: {
        monthly_average_sales: round2(averageMonthlySales),
        prudent_projection: buildScenarioValue(averageMonthlySales, 0.85),
        aggressive_projection: buildScenarioValue(averageMonthlySales, 1.15)
      }
    },
    {
      key: "cash_30d_baseline",
      forecast_domain: "cash",
      forecast_type: "cash_collection_run_rate_30d",
      scenario_label: "baseline",
      projected_value: averageMonthlyCollected,
      projected_unit: "USD",
      explanation: "Projection des encaissements sur 30 jours selon le rythme recent d'encaissement.",
      forecast_payload: {
        monthly_average_collected: round2(averageMonthlyCollected),
        minimum_cash_threshold_usd: round2(cashThreshold),
        prudent_projection: buildScenarioValue(averageMonthlyCollected, 0.8),
        aggressive_projection: buildScenarioValue(averageMonthlyCollected, 1.1)
      }
    },
    {
      key: "receivables_30d_baseline",
      forecast_domain: "receivables",
      forecast_type: "receivables_exposure_30d",
      scenario_label: "baseline",
      projected_value: currentReceivables,
      projected_unit: "USD",
      explanation: "Exposition de creances a surveiller sur 30 jours.",
      forecast_payload: {
        current_receivables: round2(currentReceivables),
        overdue_invoice_count: overdueInvoices
      }
    },
    {
      key: "stock_alerts_30d_baseline",
      forecast_domain: "stock",
      forecast_type: "stock_alert_pressure_30d",
      scenario_label: "baseline",
      projected_value: currentStockAlerts,
      projected_unit: "alerts",
      explanation: "Pression stock estimee a partir du nombre actuel d'alertes ouvertes.",
      forecast_payload: {
        current_stock_alerts: currentStockAlerts,
        strategic_risk_hint:
          currentStockAlerts > 0 ? "Review strategic products and replenishment priorities." : "No immediate critical stock pressure."
      }
    }
  ];

  const saved = [];

  for (const definition of definitions) {
    const row = await upsertAIForecast({
      forecast_key: definition.key,
      source_agent: "forecasting_service",
      forecast_domain: definition.forecast_domain,
      forecast_type: definition.forecast_type,
      period_granularity: "day",
      horizon_days: 30,
      horizon_start: horizonStart,
      horizon_end: horizonEnd,
      scenario_label: definition.scenario_label,
      method_name: "run_rate_v1",
      confidence_score: 68,
      input_snapshot: {
        global_stats: globalStats,
        recent_periods: recentPeriods,
        stock_alerts_count: currentStockAlerts,
        overdue_invoices: overdueInvoices
      },
      forecast_payload: definition.forecast_payload,
      projected_value: definition.projected_value,
      projected_unit: definition.projected_unit,
      explanation: definition.explanation
    });

    saved.push(row);
  }

  return saved;
}

export async function listPersistedAIForecasts({
  forecast_domain = null,
  scenario_label = null,
  limit = 100
} = {}) {
  return getAIForecasts({ forecast_domain, scenario_label, limit });
}
