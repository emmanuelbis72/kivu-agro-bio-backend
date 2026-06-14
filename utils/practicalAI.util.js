function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function addDaysIso(days = 0, now = new Date()) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Number(days || 0)));
  return date.toISOString().slice(0, 10);
}

function normalizePriority(value) {
  const priority = String(value || "medium").trim().toLowerCase();

  if (["critical", "urgent"].includes(priority)) return "critical";
  if (["high", "important"].includes(priority)) return "high";
  if (["medium", "watch", "monitor"].includes(priority)) return "medium";
  return "low";
}

function defaultDeadlineDays(priority) {
  if (priority === "critical") return 0;
  if (priority === "high") return 3;
  if (priority === "medium") return 7;
  return 14;
}

export function createPracticalAction(input = {}, now = new Date()) {
  const priority = normalizePriority(input.priority);
  const deadlineDays =
    input.deadline_days === undefined
      ? defaultDeadlineDays(priority)
      : Number(input.deadline_days || 0);

  return {
    id: input.id || null,
    domain: input.domain || "general",
    priority,
    title: String(input.title || "Action a traiter").trim(),
    action: String(input.action || input.recommendation || "").trim(),
    rationale: String(input.rationale || input.justification || "").trim(),
    owner_role: input.owner_role || "Direction",
    deadline: input.deadline || addDaysIso(deadlineDays, now),
    deadline_days: deadlineDays,
    amount_at_stake:
      input.amount_at_stake === undefined
        ? null
        : roundAmount(input.amount_at_stake),
    target_amount:
      input.target_amount === undefined ? null : roundAmount(input.target_amount),
    target_unit: input.target_unit || (input.domain === "stock" ? "unites" : "USD"),
    entity_type: input.entity_type || null,
    entity_id: input.entity_id || null,
    entity_label: input.entity_label || null,
    first_step: String(input.first_step || input.action || "").trim(),
    steps: Array.isArray(input.steps)
      ? input.steps.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
      : [],
    success_metric: String(input.success_metric || "").trim() || null,
    decision_required: String(input.decision_required || "").trim() || null,
    approval_required: Boolean(input.approval_required),
    source: input.source || "deterministic"
  };
}

export function buildPracticalActionPlan(recommendations = [], now = new Date()) {
  return (Array.isArray(recommendations) ? recommendations : [])
    .map((item, index) => {
      if (typeof item === "string") {
        return createPracticalAction(
          {
            id: `action-${index + 1}`,
            title: item.split(":")[0] || `Action ${index + 1}`,
            action: item,
            priority: "medium"
          },
          now
        );
      }

      return createPracticalAction(
        {
          id: item.id || `action-${index + 1}`,
          ...item,
          rationale: item.rationale || item.justification,
          action: item.action || item.recommendation
        },
        now
      );
    })
    .filter((item) => item.action)
    .sort((left, right) => {
      const weight = { critical: 4, high: 3, medium: 2, low: 1 };
      return weight[right.priority] - weight[left.priority];
    })
    .slice(0, 8);
}

export function formatPracticalAction(action = {}) {
  const amount =
    action.target_amount !== null && action.target_amount !== undefined
      ? ` Objectif: ${roundAmount(action.target_amount)} ${action.target_unit || "USD"}.`
      : "";

  return `${action.title}: ${action.action} Responsable: ${action.owner_role}. Echeance: ${action.deadline}.${amount}`;
}
