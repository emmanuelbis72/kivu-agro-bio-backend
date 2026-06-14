import { getBusinessRulesMap } from "./businessRules.service.js";
import { getProductScores } from "./productScoring.service.js";
import { getCustomerScores } from "./customerScoring.service.js";
import { getCashScore } from "./cashScoring.service.js";
import { createPracticalAction } from "../../utils/practicalAI.util.js";

export async function getAIScoringSummary() {
  const businessRules = await getBusinessRulesMap();

  const [products, customers, cash] = await Promise.all([
    getProductScores(businessRules),
    getCustomerScores(businessRules),
    getCashScore(businessRules)
  ]);

  const customerActions = customers
    .filter((row) => Number(row.total_balance_due || 0) > 0)
    .slice(0, 5)
    .map((row) =>
      createPracticalAction({
        id: `customer-${row.customer_id}`,
        domain: "receivables",
        priority: row.risk_level,
        title: `Recouvrer ${row.business_name}`,
        action: row.recommendation,
        rationale: row.explanation,
        owner_role: row.owner_role,
        deadline_days: row.deadline_days,
        amount_at_stake: row.total_balance_due,
        target_amount: row.target_collection_amount,
        entity_type: "customer",
        entity_id: row.customer_id,
        entity_label: row.business_name,
        first_step: row.first_step,
        success_metric: `Paiement ou engagement date sur ${row.target_collection_amount} USD.`,
        decision_required: row.credit_decision
      })
    );
  const productActions = products
    .filter(
      (row) =>
        Number(row.recommended_reorder_quantity || 0) > 0 ||
        ["critical", "high"].includes(row.priority_level)
    )
    .slice(0, 4)
    .map((row) =>
      createPracticalAction({
        id: `product-${row.product_id}`,
        domain: "stock",
        priority: row.priority_level,
        title: `Securiser ${row.product_name}`,
        action: row.recommendation,
        rationale: row.explanation,
        owner_role: row.owner_role,
        deadline_days: row.deadline_days,
        target_amount: row.recommended_reorder_quantity,
        target_unit: "unites",
        entity_type: "product",
        entity_id: row.product_id,
        entity_label: row.product_name,
        first_step: row.first_step,
        success_metric: row.success_metric,
        decision_required: "Valider achat ou transfert inter-depots."
      })
    );
  const cashAction = createPracticalAction({
    id: "cash-control",
    domain: "cash",
    priority: cash.status === "critical" ? "critical" : cash.status === "watch" ? "high" : "medium",
    title: "Securiser la tresorerie",
    action: cash.recommendation,
    rationale: cash.explanation,
    owner_role: cash.owner_role,
    deadline_days: cash.deadline_days,
    amount_at_stake: cash.overdue_receivables,
    first_step: cash.first_step,
    success_metric: cash.success_metric
  });
  const actionPlan = [...customerActions, ...productActions, cashAction]
    .sort((left, right) => {
      const weight = { critical: 4, high: 3, medium: 2, low: 1 };
      return weight[right.priority] - weight[left.priority];
    })
    .slice(0, 10);

  return {
    top_priority_products: products.slice(0, 10),
    top_risky_customers: customers.slice(0, 10),
    cash,
    executive_control_tower: {
      headline:
        actionPlan.length > 0
          ? `${actionPlan.filter((item) => item.priority === "critical").length} action(s) critique(s) et ${actionPlan.filter((item) => item.priority === "high").length} action(s) haute priorite a piloter.`
          : "Aucune action prioritaire detectee.",
      priorities_today: actionPlan.filter(
        (item) => item.deadline_days <= 1
      ),
      action_plan: actionPlan,
      decisions_required: actionPlan
        .filter((item) => item.decision_required)
        .map((item) => ({
          action_id: item.id,
          title: item.title,
          decision: item.decision_required,
          deadline: item.deadline
        })),
      management_rhythm: {
        daily:
          "Revue de 15 minutes: encaissements promis, actions en retard, ruptures et soldes de tresorerie.",
        weekly:
          "Revue direction: actions cloturees, impact financier obtenu et decisions a arbitrer.",
        success_metrics: [
          "Montant encaisse sur creances prioritaires",
          "Nombre d'engagements de paiement tenus",
          "Produits critiques ramenes au-dessus de 20 jours de couverture",
          "Actions cloturees dans le delai"
        ]
      }
    },
    generated_at: new Date().toISOString()
  };
}
