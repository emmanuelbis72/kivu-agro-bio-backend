import { detectIntent } from "../services/ai/naturalQuery.service.js";
import { runDeterministicAnalysis } from "../services/analytics/deterministicAnalytics.service.js";
import { safeRecordAuditEvent } from "../services/audit.service.js";

export async function runAnalyticsHandler(req, res, next) {
  try {
    const question = String(req.body?.question || req.query?.question || "").trim();
    const requestedIntent = String(
      req.body?.intent || req.query?.intent || ""
    ).trim();
    const detected = question ? detectIntent(question) : null;
    const intent = requestedIntent || detected?.intent || "business_overview";
    const period =
      String(req.body?.period || req.query?.period || detected?.period || "this_month");
    const result = await runDeterministicAnalysis({ intent, period });

    await safeRecordAuditEvent({
      req,
      module: "analytics",
      action_type: "analysis",
      entity_type: "deterministic_analysis",
      entity_id: result.analysis_id,
      new_value: {
        intent,
        period: result.period,
        metrics: result.metrics,
        sources: result.sources
      },
      reason: question || "Analyse demandee depuis l'API",
      risk_level: "low"
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}
