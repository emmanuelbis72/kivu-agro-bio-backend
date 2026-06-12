BEGIN;

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
    action_type IN (
      'create', 'update', 'delete', 'archive', 'validate', 'cancel',
      'login', 'analysis', 'export'
    )
  ),
  CONSTRAINT audit_logs_status_chk CHECK (
    status IN ('success', 'failed', 'denied', 'pending')
  ),
  CONSTRAINT audit_logs_risk_chk CHECK (
    risk_level IN ('low', 'medium', 'high', 'critical')
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

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

COMMIT;
