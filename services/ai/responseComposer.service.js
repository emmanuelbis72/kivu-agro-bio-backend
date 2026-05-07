function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function composeAIResponse({
  question,
  intentResult,
  analysis
}) {
  const recommendations = analysis.recommendations || [];
  const actions =
    Array.isArray(analysis.actions) && analysis.actions.length > 0
      ? analysis.actions
      : recommendations;

  return {
    question,
    intent: intentResult.intent,
    period: intentResult.period,
    confidence_score: round2(intentResult.confidence || 0),
    summary: analysis.summary,
    answer: analysis.answer,
    metrics: analysis.metrics || {},
    drivers: analysis.drivers || [],
    risks: analysis.risks || [],
    opportunities: analysis.opportunities || [],
    recommendations,
    actions,
    priority_level: analysis.priority_level || "MEDIUM",
    source_module: analysis.source_module || null,
    generated_at: new Date().toISOString()
  };
}
