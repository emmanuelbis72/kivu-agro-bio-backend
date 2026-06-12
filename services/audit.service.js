import crypto from "crypto";
import { createAuditLog } from "../models/auditLog.model.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "bootstrap_token"
]);

export function sanitizeAuditValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeAuditValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase())
        ? "[REDACTED]"
        : sanitizeAuditValue(item)
    ])
  );
}

export function getChangedFields(oldValue, newValue) {
  if (!oldValue || !newValue) return [];

  const keys = new Set([
    ...Object.keys(oldValue || {}),
    ...Object.keys(newValue || {})
  ]);

  return [...keys].filter(
    (key) =>
      JSON.stringify(oldValue?.[key] ?? null) !==
      JSON.stringify(newValue?.[key] ?? null)
  );
}

function getRequestIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || null;
}

export async function recordAuditEvent({
  req = null,
  actor = null,
  module,
  action_type,
  entity_type = null,
  entity_id = null,
  document_reference = null,
  old_value = null,
  new_value = null,
  reason = null,
  status = "success",
  risk_level = "medium",
  metadata = {}
}) {
  const effectiveActor = actor || req?.user || null;
  const safeOldValue = sanitizeAuditValue(old_value);
  const safeNewValue = sanitizeAuditValue(new_value);

  return createAuditLog({
    event_key: `audit_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`,
    user_id: effectiveActor?.id || null,
    user_name: effectiveActor?.full_name || effectiveActor?.name || "system",
    user_role: effectiveActor?.role || "system",
    module,
    action_type,
    entity_type,
    entity_id,
    document_reference,
    old_value: safeOldValue,
    new_value: safeNewValue,
    changed_fields: getChangedFields(safeOldValue, safeNewValue),
    reason,
    ip_address: getRequestIp(req),
    user_agent: req?.headers?.["user-agent"] || null,
    request_method: req?.method || null,
    request_path: req?.originalUrl || null,
    status,
    risk_level,
    metadata
  });
}

export async function safeRecordAuditEvent(payload) {
  try {
    return await recordAuditEvent(payload);
  } catch (error) {
    console.error("[AUDIT] Echec de journalisation:", error.message);
    return null;
  }
}
