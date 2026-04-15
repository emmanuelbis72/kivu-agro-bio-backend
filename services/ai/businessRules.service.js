import {
  getAllBusinessRules,
  getBusinessRuleByKey,
  upsertBusinessRule
} from "../../models/ai/businessRule.model.js";

const defaultBusinessRules = {
  strategic_products: [
    "FULL DETOX",
    "FULL OPTIONS",
    "FULL ENERGIE",
    "MORINGA EN POUDRE",
    "CACAO EN POUDRE",
    "GRAINES DE CHIA",
    "LIBIDO POWER",
    "MACA"
  ],
  priority_cities: ["Kinshasa", "Lubumbashi", "Kolwezi", "Matadi"],
  priority_channels: [
    "CARREFOUR",
    "GG MART",
    "SWISSMART",
    "REGAL",
    "HYPER PSARO CARREFOUR",
    "SK SUPERMARCHE"
  ],
  minimum_cash_threshold_usd: 3000,
  target_net_margin_range: {
    min: 25,
    max: 30
  },
  high_priority_stock_alert_count: 5,
  monthly_revenue_targets: {
    current_minimum_monthly_received_payments_usd: 30000,
    target_from_july_2026_monthly_received_payments_usd: 35000,
    target_by_december_2026_monthly_received_payments_usd: 50000
  }
};

export async function getBusinessRulesMap() {
  try {
    const rows = await getAllBusinessRules();

    if (!Array.isArray(rows) || rows.length === 0) {
      return defaultBusinessRules;
    }

    const map = { ...defaultBusinessRules };

    for (const row of rows) {
      map[row.rule_key] = row.rule_value;
    }

    return map;
  } catch (error) {
    return defaultBusinessRules;
  }
}

export async function getBusinessRuleValue(ruleKey) {
  try {
    const row = await getBusinessRuleByKey(ruleKey);
    return row ? row.rule_value : defaultBusinessRules[ruleKey];
  } catch (error) {
    return defaultBusinessRules[ruleKey];
  }
}

export async function saveBusinessRule({ ruleKey, ruleValue, description }) {
  return upsertBusinessRule({
    rule_key: ruleKey,
    rule_value: ruleValue,
    description
  });
}

export function validateBusinessRuleValue(ruleKey, ruleValue) {
  switch (ruleKey) {
    case "strategic_products":
    case "priority_cities":
    case "priority_channels": {
      if (
        !Array.isArray(ruleValue) ||
        ruleValue.some((item) => typeof item !== "string" || !item.trim())
      ) {
        return {
          isValid: false,
          message: `La règle "${ruleKey}" doit être un tableau JSON de chaînes non vides.`
        };
      }

      return { isValid: true };
    }

    case "minimum_cash_threshold_usd":
    case "high_priority_stock_alert_count": {
      if (typeof ruleValue !== "number" || Number.isNaN(ruleValue)) {
        return {
          isValid: false,
          message: `La règle "${ruleKey}" doit être un nombre JSON valide.`
        };
      }

      return { isValid: true };
    }

    case "target_net_margin_range": {
      if (
        !ruleValue ||
        typeof ruleValue !== "object" ||
        Array.isArray(ruleValue) ||
        typeof ruleValue.min !== "number" ||
        typeof ruleValue.max !== "number"
      ) {
        return {
          isValid: false,
          message:
            'La règle "target_net_margin_range" doit être un objet JSON avec min et max numériques.'
        };
      }

      return { isValid: true };
    }

    case "monthly_revenue_targets": {
      if (
        !ruleValue ||
        typeof ruleValue !== "object" ||
        Array.isArray(ruleValue) ||
        typeof ruleValue.current_minimum_monthly_received_payments_usd !==
          "number" ||
        typeof ruleValue.target_from_july_2026_monthly_received_payments_usd !==
          "number" ||
        typeof ruleValue.target_by_december_2026_monthly_received_payments_usd !==
          "number"
      ) {
        return {
          isValid: false,
          message:
            'La règle "monthly_revenue_targets" doit être un objet JSON avec les trois champs numériques attendus.'
        };
      }

      return { isValid: true };
    }

    default:
      return { isValid: true };
  }
}

export function isStrategicProduct(productName, businessRules = {}) {
  const strategicProducts = Array.isArray(businessRules.strategic_products)
    ? businessRules.strategic_products
    : defaultBusinessRules.strategic_products;

  const normalized = String(productName || "").trim().toUpperCase();

  return strategicProducts.some(
    (item) => String(item || "").trim().toUpperCase() === normalized
  );
}

export function isPriorityChannel(channelName, businessRules = {}) {
  const priorityChannels = Array.isArray(businessRules.priority_channels)
    ? businessRules.priority_channels
    : defaultBusinessRules.priority_channels;

  const normalized = String(channelName || "").trim().toUpperCase();

  return priorityChannels.some((item) =>
    normalized.includes(String(item || "").trim().toUpperCase())
  );
}

export function isPriorityCity(cityName, businessRules = {}) {
  const priorityCities = Array.isArray(businessRules.priority_cities)
    ? businessRules.priority_cities
    : defaultBusinessRules.priority_cities;

  const normalized = String(cityName || "").trim().toUpperCase();

  return priorityCities.some(
    (item) => String(item || "").trim().toUpperCase() === normalized
  );
}

export function getMonthlyRevenueTargets(businessRules = {}) {
  const targets = businessRules.monthly_revenue_targets;

  if (targets && typeof targets === "object" && !Array.isArray(targets)) {
    return targets;
  }

  return defaultBusinessRules.monthly_revenue_targets;
}