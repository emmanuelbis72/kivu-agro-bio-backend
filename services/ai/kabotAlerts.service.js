import {
  getGlobalStats,
  getStockAlerts,
  getTopCustomers,
  getTopProducts,
  getCashForecast
} from "../../models/dashboard.model.js";
import { getAllInvoices } from "../../models/invoice.model.js";
import { createPracticalAction } from "../../utils/practicalAI.util.js";
import {
  getBusinessRulesMap,
  isPriorityCity,
  isPriorityChannel,
  isStrategicProduct
} from "./businessRules.service.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function daysBetween(dateValue) {
  if (!dateValue) return 0;

  const input = new Date(dateValue);
  const now = new Date();

  if (Number.isNaN(input.getTime())) {
    return 0;
  }

  const diffMs = now.getTime() - input.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function priorityWeight(priority) {
  switch (String(priority || "").toUpperCase()) {
    case "CRITICAL":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    default:
      return 1;
  }
}

function makeAlert({
  code,
  title,
  category,
  priority,
  summary,
  recommendation,
  entity_type = null,
  entity_id = null,
  meta = {},
  owner_role = null,
  deadline_days = null,
  first_step = null,
  success_metric = null,
  decision_required = null
}) {
  const normalizedPriority = String(priority || "LOW").toUpperCase();
  const defaultOwner = {
    receivables: "Responsable recouvrement",
    cash: "Direction financiere",
    stock: "Responsable stock et achats",
    margin: "Direction commerciale et finance",
    sales: "Direction commerciale"
  };
  const practicalAction = createPracticalAction({
    id: code,
    domain: category,
    priority: normalizedPriority,
    title,
    action: recommendation,
    rationale: summary,
    owner_role: owner_role || defaultOwner[category] || "Direction",
    deadline_days:
      deadline_days ??
      (normalizedPriority === "CRITICAL"
        ? 0
        : normalizedPriority === "HIGH"
          ? 2
          : 7),
    amount_at_stake:
      meta.balance_due ??
      meta.overdue_receivables ??
      meta.total_receivables ??
      meta.concentration_amount ??
      null,
    entity_type,
    entity_id,
    entity_label:
      meta.customer_name || meta.product_name || meta.invoice_number || null,
    first_step: first_step || recommendation,
    success_metric:
      success_metric ||
      "Action executee, resultat mesure et alerte cloturee par le responsable.",
    decision_required
  });

  return {
    code,
    title,
    category,
    priority: normalizedPriority,
    priority_weight: priorityWeight(priority),
    summary,
    recommendation,
    entity_type,
    entity_id,
    meta,
    owner_role: practicalAction.owner_role,
    deadline: practicalAction.deadline,
    first_step: practicalAction.first_step,
    success_metric: practicalAction.success_metric,
    decision_required: practicalAction.decision_required,
    practical_action: practicalAction,
    generated_at: new Date().toISOString()
  };
}

function analyzeReceivableAlerts(invoices, businessRules) {
  const alerts = [];

  for (const invoice of invoices) {
    const balanceDue = Number(invoice.balance_due || 0);
    if (balanceDue <= 0) continue;

    const ageDays = daysBetween(invoice.invoice_date);
    const customerName = invoice.customer_name || "Client inconnu";
    const warehouseName = invoice.warehouse_name || "Dépôt inconnu";
    const isPriority =
      isPriorityCity(invoice.customer_city, businessRules) ||
      isPriorityChannel(warehouseName, businessRules);

    if (ageDays > 60) {
      alerts.push(
        makeAlert({
          code: `receivable_over_60_${invoice.id}`,
          title: "Créance en retard critique",
          category: "receivables",
          priority: isPriority ? "CRITICAL" : "HIGH",
          summary:
            `La facture ${invoice.invoice_number} de ${customerName} présente un solde de ${round2(balanceDue)} USD ` +
            `et un âge estimé de ${ageDays} jours.`,
          recommendation:
            "Relancer immédiatement le client, suspendre le crédit additionnel si nécessaire et prioriser le recouvrement.",
          entity_type: "invoice",
          entity_id: invoice.id,
          meta: {
            invoice_number: invoice.invoice_number,
            customer_name: customerName,
            warehouse_name: warehouseName,
            balance_due: round2(balanceDue),
            age_days: ageDays
          }
        })
      );
      continue;
    }

    if (ageDays >= 30) {
      alerts.push(
        makeAlert({
          code: `receivable_over_30_${invoice.id}`,
          title: "Créance à surveiller",
          category: "receivables",
          priority: isPriority ? "HIGH" : "MEDIUM",
          summary:
            `La facture ${invoice.invoice_number} de ${customerName} reste impayée à hauteur de ${round2(balanceDue)} USD ` +
            `après ${ageDays} jours.`,
          recommendation:
            "Programmer une relance active et suivre le compte jusqu’au règlement ou à un accord de paiement.",
          entity_type: "invoice",
          entity_id: invoice.id,
          meta: {
            invoice_number: invoice.invoice_number,
            customer_name: customerName,
            warehouse_name: warehouseName,
            balance_due: round2(balanceDue),
            age_days: ageDays
          }
        })
      );
    }
  }

  return alerts;
}

function analyzeStockAlerts(stockAlerts, businessRules) {
  return stockAlerts.map((row) => {
    const quantity = Number(row.quantity || 0);
    const threshold = Number(row.alert_threshold || 0);
    const productName = row.product_name || "Produit inconnu";
    const warehouseName = row.warehouse_name || "Dépôt inconnu";

    const strategic = isStrategicProduct(productName, businessRules);
    const priorityCity = isPriorityCity(row.warehouse_city, businessRules);
    const priorityChannel = isPriorityChannel(warehouseName, businessRules);

    let priority = "MEDIUM";

    if (quantity <= 0 && strategic) priority = "CRITICAL";
    else if (quantity <= 0) priority = "HIGH";
    else if (strategic || priorityCity || priorityChannel) priority = "HIGH";

    return makeAlert({
      code: `stock_alert_${row.product_id}_${row.warehouse_id}`,
      title: strategic
        ? "Rupture ou tension sur produit stratégique"
        : "Alerte stock",
      category: "stock",
      priority,
      summary:
        `${productName} est à ${round2(quantity)} unité(s) dans ${warehouseName} ` +
        `pour un seuil de ${round2(threshold)}.`,
      recommendation: strategic
        ? "Réapprovisionner en priorité ce produit et arbitrer les stocks disponibles entre les dépôts critiques."
        : "Contrôler la rotation et planifier le réapprovisionnement si la demande reste active.",
      entity_type: "product",
      entity_id: row.product_id,
      meta: {
        product_name: productName,
        warehouse_name: warehouseName,
        quantity: round2(quantity),
        alert_threshold: round2(threshold),
        strategic
      }
    });
  });
}

function analyzeLowMarginInvoices(invoices) {
  const alerts = [];

  for (const invoice of invoices) {
    const gp = Number(invoice.gross_profit_amount || 0);
    const netSales =
      Number(invoice.total_amount || 0) - Number(invoice.tax_amount || 0);

    if (netSales <= 0) continue;

    const margin = (gp / netSales) * 100;

    if (margin < 10) {
      alerts.push(
        makeAlert({
          code: `low_margin_critical_${invoice.id}`,
          title: "Marge facture très faible",
          category: "profitability",
          priority: "CRITICAL",
          summary:
            `La facture ${invoice.invoice_number} a une marge brute estimée de ${round2(margin)} % ` +
            `pour ${round2(netSales)} USD de ventes nettes.`,
          recommendation:
            "Vérifier le coût réel, le prix de vente, les remises accordées et le canal concerné avant répétition du schéma.",
          entity_type: "invoice",
          entity_id: invoice.id,
          meta: {
            invoice_number: invoice.invoice_number,
            gross_profit_amount: round2(gp),
            net_sales_amount: round2(netSales),
            gross_margin_percent: round2(margin)
          }
        })
      );
      continue;
    }

    if (margin < 20) {
      alerts.push(
        makeAlert({
          code: `low_margin_warning_${invoice.id}`,
          title: "Marge facture sous surveillance",
          category: "profitability",
          priority: "HIGH",
          summary:
            `La facture ${invoice.invoice_number} a une marge brute estimée de ${round2(margin)} %.`,
          recommendation:
            "Surveiller le pricing, les coûts logistiques et la qualité du mix produit sur cette facture.",
          entity_type: "invoice",
          entity_id: invoice.id,
          meta: {
            invoice_number: invoice.invoice_number,
            gross_profit_amount: round2(gp),
            net_sales_amount: round2(netSales),
            gross_margin_percent: round2(margin)
          }
        })
      );
    }
  }

  return alerts;
}

function analyzeCashAlerts(cashForecast, businessRules) {
  const alerts = [];
  const summary = cashForecast?.summary || {};
  const currentCash = Number(summary.current_cash_base || 0);
  const receivables = Number(summary.open_receivables || 0);
  const overdueReceivables = Number(summary.overdue_receivables || 0);
  const minimumCashThreshold = Number(
    businessRules?.minimum_cash_threshold_usd || 3000
  );

  if (currentCash < minimumCashThreshold) {
    alerts.push(
      makeAlert({
        code: "cash_below_threshold",
        title: "Seuil de cash sous vigilance",
        category: "cash",
        priority: "CRITICAL",
        summary: `La tresorerie disponible (${round2(currentCash)} USD) est sous le seuil de vigilance de ${round2(minimumCashThreshold)} USD.`,
        recommendation:
          "Geler les sorties non essentielles et confirmer aujourd'hui les encaissements attendus a J+7.",
        first_step:
          "Extraire les paiements prevus sous 7 jours et appeler les trois clients aux plus forts encours.",
        success_metric: `Tresorerie disponible ramenee au-dessus de ${round2(minimumCashThreshold)} USD.`,
        decision_required:
          "Valider le gel temporaire des depenses non prioritaires.",
        meta: {
          current_cash_base: round2(currentCash),
          total_receivables: round2(receivables),
          overdue_receivables: round2(overdueReceivables),
          minimum_cash_threshold_usd: round2(minimumCashThreshold)
        }
      })
    );
  }

  if (
    overdueReceivables > 0 &&
    overdueReceivables / Math.max(receivables, 1) >= 0.25
  ) {
    alerts.push(
      makeAlert({
        code: "receivables_pressure",
        title: "Pression créances élevée",
        category: "cash",
        priority: "HIGH",
        summary: `${round2(overdueReceivables)} USD de creances sont echues sur ${round2(receivables)} USD d'encours ouverts.`,
        recommendation:
          "Obtenir un paiement ou un engagement date sur les cinq plus gros encours echus.",
        deadline_days: 0,
        first_step:
          "Affecter aujourd'hui chaque encours prioritaire a un responsable de relance.",
        success_metric:
          "100 % des cinq principaux encours ont un paiement ou un engagement date.",
        decision_required:
          "Valider la suspension de credit des comptes sans engagement.",
        meta: {
          total_receivables: round2(receivables),
          overdue_receivables: round2(overdueReceivables)
        }
      })
    );
  }

  return alerts;
}

function analyzeChannelConcentration(topCustomers) {
  const alerts = [];

  if (!Array.isArray(topCustomers) || topCustomers.length === 0) {
    return alerts;
  }

  const top1 = topCustomers[0];
  const top2 = topCustomers[1];

  if (top1 && Number(top1.total_billed || 0) > 10000) {
    alerts.push(
      makeAlert({
        code: `customer_concentration_${top1.customer_id}`,
        title: "Concentration commerciale à surveiller",
        category: "sales",
        priority: "MEDIUM",
        summary:
          `${top1.business_name} représente un compte majeur avec ${round2(
            top1.total_billed
          )} USD facturés.`,
        recommendation:
          "Sécuriser la relation commerciale tout en développant d’autres comptes structurants pour réduire la dépendance.",
        entity_type: "customer",
        entity_id: top1.customer_id,
        meta: {
          customer_name: top1.business_name,
          total_billed: round2(top1.total_billed || 0)
        }
      })
    );
  }

  if (top1 && top2) {
    const concentration =
      Number(top1.total_billed || 0) + Number(top2.total_billed || 0);

    if (concentration > 15000) {
      alerts.push(
        makeAlert({
          code: "top2_customer_concentration",
          title: "Concentration sur les deux premiers clients",
          category: "sales",
          priority: "MEDIUM",
          summary:
            `Les deux premiers clients concentrent environ ${round2(concentration)} USD de facturation.`,
          recommendation:
            "Élargir progressivement la base clients structurants pour réduire le risque commercial.",
          meta: {
            top_customer_1: top1.business_name,
            top_customer_2: top2.business_name,
            concentration_amount: round2(concentration)
          }
        })
      );
    }
  }

  return alerts;
}

export async function getKabotAlerts() {
  const [businessRules, globalStats, stockAlerts, topCustomers, topProducts, invoices, cashForecast] =
    await Promise.all([
      getBusinessRulesMap(),
      getGlobalStats(),
      getStockAlerts(),
      getTopCustomers(10),
      getTopProducts(10),
      getAllInvoices(),
      getCashForecast(10)
    ]);

  const alerts = [
    ...analyzeCashAlerts(cashForecast, businessRules),
    ...analyzeReceivableAlerts(invoices, businessRules),
    ...analyzeStockAlerts(stockAlerts, businessRules),
    ...analyzeLowMarginInvoices(invoices),
    ...analyzeChannelConcentration(topCustomers)
  ]
    .sort((a, b) => b.priority_weight - a.priority_weight)
    .slice(0, 50);

  const summary = {
    total_alerts: alerts.length,
    critical_count: alerts.filter((item) => item.priority === "CRITICAL").length,
    high_count: alerts.filter((item) => item.priority === "HIGH").length,
    medium_count: alerts.filter((item) => item.priority === "MEDIUM").length,
    low_count: alerts.filter((item) => item.priority === "LOW").length,
    reference_kpis: {
      total_sales_amount: round2(globalStats?.total_sales_amount || 0),
      total_collected_amount: round2(globalStats?.total_collected_amount || 0),
      total_receivables: round2(globalStats?.total_receivables || 0),
      total_cogs_amount: round2(globalStats?.total_cogs_amount || 0),
      gross_profit_amount: round2(globalStats?.gross_profit_amount || 0)
    },
    top_products_reference: topProducts.slice(0, 5)
  };

  return {
    summary,
    alerts,
    control_tower: {
      priorities_today: alerts
        .filter((item) => item.practical_action.deadline_days <= 1)
        .slice(0, 10)
        .map((item) => item.practical_action),
      action_plan: alerts.slice(0, 15).map((item) => item.practical_action),
      decisions_required: alerts
        .filter((item) => item.decision_required)
        .slice(0, 10)
        .map((item) => ({
          alert_code: item.code,
          title: item.title,
          decision: item.decision_required,
          deadline: item.deadline
        })),
      closure_rule:
        "Une alerte est cloturee seulement quand le responsable renseigne le resultat et que l'indicateur de succes est atteint."
    }
  };
}
