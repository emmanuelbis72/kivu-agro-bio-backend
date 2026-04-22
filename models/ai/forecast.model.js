import { pool } from "../../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaRetry
} from "../../utils/schemaSelfHealing.util.js";

function toJson(value, fallback = {}) {
  return JSON.stringify(value === undefined || value === null ? fallback : value);
}

async function ensureAIForecastsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS ai_forecasts (
      id SERIAL PRIMARY KEY,
      forecast_key VARCHAR(120) NOT NULL UNIQUE,
      run_id INTEGER REFERENCES ai_agent_runs(id) ON DELETE SET NULL,
      source_agent VARCHAR(100) NOT NULL,
      forecast_domain VARCHAR(50) NOT NULL,
      forecast_type VARCHAR(80) NOT NULL,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      period_granularity VARCHAR(20) NOT NULL DEFAULT 'day',
      horizon_days INTEGER NOT NULL,
      horizon_start DATE NOT NULL,
      horizon_end DATE NOT NULL,
      scenario_label VARCHAR(50) NOT NULL DEFAULT 'baseline',
      method_name VARCHAR(100),
      confidence_score NUMERIC(5,2),
      input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      forecast_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      projected_value NUMERIC(18,4),
      projected_unit VARCHAR(30),
      explanation TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT ai_forecasts_domain_chk CHECK (
        forecast_domain IN ('stock', 'sales', 'cash', 'receivables', 'expenses', 'production', 'marketing', 'general')
      ),
      CONSTRAINT ai_forecasts_period_granularity_chk CHECK (
        period_granularity IN ('day', 'week', 'month', 'quarter')
      ),
      CONSTRAINT ai_forecasts_scenario_label_chk CHECK (
        scenario_label IN ('baseline', 'prudent', 'aggressive', 'stress', 'custom')
      ),
      CONSTRAINT ai_forecasts_horizon_days_chk CHECK (
        horizon_days > 0
      ),
      CONSTRAINT ai_forecasts_horizon_dates_chk CHECK (
        horizon_end >= horizon_start
      ),
      CONSTRAINT ai_forecasts_confidence_chk CHECK (
        confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)
      )
    );

    CREATE INDEX IF NOT EXISTS idx_ai_forecasts_domain
      ON ai_forecasts (forecast_domain);

    CREATE INDEX IF NOT EXISTS idx_ai_forecasts_entity
      ON ai_forecasts (entity_type, entity_id);

    CREATE INDEX IF NOT EXISTS idx_ai_forecasts_horizon_start
      ON ai_forecasts (horizon_start);

    CREATE INDEX IF NOT EXISTS idx_ai_forecasts_horizon_end
      ON ai_forecasts (horizon_end);

    CREATE INDEX IF NOT EXISTS idx_ai_forecasts_created_at
      ON ai_forecasts (created_at DESC);
  `;

  await ensureTableSchema({
    executor: (text) => pool.query(text),
    relationName: "ai_forecasts",
    createSql: query
  });
}

async function queryWithAIForecastsSchemaRetry(query, values = []) {
  return queryWithSchemaRetry({
    executor: (text, params) => pool.query(text, params),
    ensureSchema: ensureAIForecastsTable,
    query,
    values
  });
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

  const result = await queryWithAIForecastsSchemaRetry(query, [
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

  const result = await queryWithAIForecastsSchemaRetry(query, values);
  return result.rows;
}
