import { pool } from "../../config/db.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

export async function upsertAIForecast({
  forecast_key,
  run_id = null,
  source_agent,
  forecast_domain,
  forecast_type,
  entity_type = null,
  entity_id = null,
  period_granularity = "day",
  horizon_days,
  horizon_start,
  horizon_end,
  scenario_label = "baseline",
  method_name = null,
  confidence_score = null,
  input_snapshot = {},
  forecast_payload = {},
  projected_value = null,
  projected_unit = null,
  explanation = null
}) {
  const query = `
    INSERT INTO ai_forecasts (
      forecast_key,
      run_id,
      source_agent,
      forecast_domain,
      forecast_type,
      entity_type,
      entity_id,
      period_granularity,
      horizon_days,
      horizon_start,
      horizon_end,
      scenario_label,
      method_name,
      confidence_score,
      input_snapshot,
      forecast_payload,
      projected_value,
      projected_unit,
      explanation
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,$19
    )
    ON CONFLICT (forecast_key)
    DO UPDATE SET
      run_id = EXCLUDED.run_id,
      source_agent = EXCLUDED.source_agent,
      forecast_domain = EXCLUDED.forecast_domain,
      forecast_type = EXCLUDED.forecast_type,
      entity_type = EXCLUDED.entity_type,
      entity_id = EXCLUDED.entity_id,
      period_granularity = EXCLUDED.period_granularity,
      horizon_days = EXCLUDED.horizon_days,
      horizon_start = EXCLUDED.horizon_start,
      horizon_end = EXCLUDED.horizon_end,
      scenario_label = EXCLUDED.scenario_label,
      method_name = EXCLUDED.method_name,
      confidence_score = EXCLUDED.confidence_score,
      input_snapshot = EXCLUDED.input_snapshot,
      forecast_payload = EXCLUDED.forecast_payload,
      projected_value = EXCLUDED.projected_value,
      projected_unit = EXCLUDED.projected_unit,
      explanation = EXCLUDED.explanation,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await pool.query(query, [
    forecast_key,
    run_id,
    source_agent,
    forecast_domain,
    forecast_type,
    entity_type,
    entity_id,
    period_granularity,
    horizon_days,
    horizon_start,
    horizon_end,
    scenario_label,
    method_name,
    confidence_score,
    toJson(input_snapshot),
    toJson(forecast_payload),
    projected_value,
    projected_unit,
    explanation
  ]);

  return result.rows[0];
}

export async function getAIForecasts({
  forecast_domain = null,
  scenario_label = null,
  limit = 100
} = {}) {
  const conditions = [];
  const values = [];

  if (forecast_domain) {
    values.push(forecast_domain);
    conditions.push(`forecast_domain = $${values.length}`);
  }

  if (scenario_label) {
    values.push(scenario_label);
    conditions.push(`scenario_label = $${values.length}`);
  }

  values.push(limit);

  const query = `
    SELECT *
    FROM ai_forecasts
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY created_at DESC, id DESC
    LIMIT $${values.length};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}
