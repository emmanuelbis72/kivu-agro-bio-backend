function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function composeAIResponse({
  question,
  intentResult,
  analysis
}) {
  return {
    question,
    intent: intentResult.intent,
    period: intentResult.period,
    confidence_score: round2(intentResult.confidence || 0),
    summary: analysis.summary,
    answer: analysis.answer,
    metrics: analysis.metrics || {},
    drivers: analysis.drivers || [],
    recommendations: analysis.recommendations || [],
    source_module: analysis.source_module || null,
    generated_at: new Date().toISOString()
  };
}