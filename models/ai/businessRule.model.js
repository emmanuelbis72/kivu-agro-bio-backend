import { pool } from "../../config/db.js";

export async function getAllBusinessRules() {
  const query = `
    SELECT id, rule_key, rule_value, description, created_at, updated_at
    FROM business_rules
    ORDER BY rule_key ASC
  `;

  const { rows } = await pool.query(query);
  return rows;
}

export async function getBusinessRuleByKey(ruleKey) {
  const query = `
    SELECT id, rule_key, rule_value, description, created_at, updated_at
    FROM business_rules
    WHERE rule_key = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [ruleKey]);
  return rows[0] || null;
}

export async function upsertBusinessRule({ rule_key, rule_value, description }) {
  const query = `
    INSERT INTO business_rules (rule_key, rule_value, description, created_at, updated_at)
    VALUES ($1, $2::jsonb, $3, NOW(), NOW())
    ON CONFLICT (rule_key)
    DO UPDATE SET
      rule_value = EXCLUDED.rule_value,
      description = EXCLUDED.description,
      updated_at = NOW()
    RETURNING id, rule_key, rule_value, description, created_at, updated_at
  `;

  const { rows } = await pool.query(query, [
    rule_key,
    JSON.stringify(rule_value),
    description || null
  ]);

  return rows[0];
}