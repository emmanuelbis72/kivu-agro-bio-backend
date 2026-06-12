import { pool } from "../config/db.js";
import {
  ensureTableSchema,
  queryWithSchemaRetry
} from "../utils/schemaSelfHealing.util.js";

export async function ensureAuditLogsTable() {
  await ensureTableSchema({
    executor: (text) => pool.query(text),
    relationName: "audit_logs",
    createSql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        event_key VARCHAR(120) NOT NULL UNIQUE,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(180),
        user_role VARCHAR(80),
        module VARCHAR(80) NOT NULL,
        action_type VARCHAR(30) NOT NULL,
        entity_type VARCHAR(80),
        entity_id VARCHAR(120),
        document_reference VARCHAR(180),
        old_value JSONB,
        new_value JSONB,
        changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        reason TEXT,
        ip_address VARCHAR(100),
        user_agent TEXT,
        request_method VARCHAR(10),
        request_path TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'success',
        risk_level VARCHAR(20) NOT NULL DEFAULT 'medium',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT audit_logs_action_chk CHECK (
          action_type IN ('create','update','delete','archive','validate','cancel','login','analysis','export')
        ),
        CONSTRAINT audit_logs_status_chk CHECK (
          status IN ('success','failed','denied','pending')
        ),
        CONSTRAINT audit_logs_risk_chk CHECK (
          risk_level IN ('low','medium','high','critical')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at
        ON audit_logs (occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id
        ON audit_logs (user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_module
        ON audit_logs (module);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
        ON audit_logs (entity_type, entity_id);

      CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
      CREATE TRIGGER trg_audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
    `
  });
}

async function queryWithAuditSchemaRetry(query, values = []) {
  return queryWithSchemaRetry({
    executor: (text, params) => pool.query(text, params),
    ensureSchema: ensureAuditLogsTable,
    query,
    values
  });
}

export async function createAuditLog(data) {
  const result = await queryWithAuditSchemaRetry(
    `
      INSERT INTO audit_logs (
        event_key, occurred_at, user_id, user_name, user_role, module,
        action_type, entity_type, entity_id, document_reference,
        old_value, new_value, changed_fields, reason, ip_address,
        user_agent, request_method, request_path, status, risk_level, metadata
      )
      VALUES (
        $1, COALESCE($2, NOW()), $3, $4, $5, $6, $7, $8, $9, $10,
        $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18,
        $19, $20, $21::jsonb
      )
      RETURNING *;
    `,
    [
      data.event_key,
      data.occurred_at || null,
      data.user_id || null,
      data.user_name || null,
      data.user_role || null,
      data.module,
      data.action_type,
      data.entity_type || null,
      data.entity_id === undefined || data.entity_id === null
        ? null
        : String(data.entity_id),
      data.document_reference || null,
      JSON.stringify(data.old_value ?? null),
      JSON.stringify(data.new_value ?? null),
      JSON.stringify(data.changed_fields || []),
      data.reason || null,
      data.ip_address || null,
      data.user_agent || null,
      data.request_method || null,
      data.request_path || null,
      data.status || "success",
      data.risk_level || "medium",
      JSON.stringify(data.metadata || {})
    ]
  );

  return result.rows[0];
}

export async function listAuditLogs({
  start_date = null,
  end_date = null,
  user_id = null,
  module = null,
  action_type = null,
  risk_level = null,
  entity_type = null,
  limit = 100,
  offset = 0
} = {}) {
  const conditions = [];
  const values = [];

  const addCondition = (sql, value) => {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  };

  if (start_date) addCondition("occurred_at >= ?::date", start_date);
  if (end_date) addCondition("occurred_at < (?::date + INTERVAL '1 day')", end_date);
  if (user_id) addCondition("user_id = ?", user_id);
  if (module) addCondition("module = ?", module);
  if (action_type) addCondition("action_type = ?", action_type);
  if (risk_level) addCondition("risk_level = ?", risk_level);
  if (entity_type) addCondition("entity_type = ?", entity_type);

  values.push(limit, offset);

  const result = await queryWithAuditSchemaRetry(
    `
      SELECT *
      FROM audit_logs
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY occurred_at DESC, id DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length};
    `,
    values
  );

  return result.rows;
}
