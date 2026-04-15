import {
  getGlobalStats,
  getStockAlerts,
  getTopProducts,
  getTopCustomers,
  getAccountingGlobalStats,
  getRecentJournalEntries
} from "../../models/dashboard.model.js";
import { getAllExpenses } from "../../models/expense.model.js";
import { getAllInvoices } from "../../models/invoice.model.js";
import { detectIntent } from "./naturalQuery.service.js";
import { composeAIResponse } from "./responseComposer.service.js";
import {
  getBusinessRulesMap,
  isStrategicProduct,
  isPriorityChannel,
  isPriorityCity
} from "./businessRules.service.js";
import { runDeepseekReasoning } from "./deepseekReasoner.service.js";

const aiHistory = [];

const quickQuestions = [
  "Pourquoi les ventes ont baissé cette semaine ?",
  "Quels produits dois-je réapprovisionner en priorité ?",
  "Quels sont mes clients les plus risqués ?",
  "Quelles dépenses pèsent le plus ce mois ?",
  "Quelle est ma situation de trésorerie ?",
  "Résume-moi la situation comptable actuelle."
];

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function buildReasoningContextData() {
  const [
    globalStats,
    stockAlerts,
    topProducts,
    topCustomers,
    expenses,
    invoices,
    accounting,
    recentEntries
  ] = await Promise.all([
    getGlobalStats(),
    getStockAlerts(),
    getTopProducts(5),
    getTopCustomers(5),
    getAllExpenses(),
    getAllInvoices(),
    getAccountingGlobalStats(),
    getRecentJournalEntries(5)
  ]);

  return {
    globalStats,
    stockAlerts,
    topProducts,
    topCustomers,
    expenses,
    invoices,
    accounting,
    recentEntries
  };
}

function getTopExpenseCategories(expenses = [], limit = 5) {
  const grouped = new Map();

  for (const expense of expenses) {
    const key = String(expense.category || "non_classe").trim();
    const current = Number(grouped.get(key) || 0);
    grouped.set(key, current + Number(expense.amount || 0));
  }

  return Array.from(grouped.entries())
    .map(([category, total_amount]) => ({
      category,
      total_amount: round2(total_amount)
    }))
    .sort((a, b) => Number(b.total_amount) - Number(a.total_amount))
    .slice(0, limit);
}

function getTopReceivableCustomers(customers = [], limit = 5) {
  return [...customers]
    .sort(
      (a, b) =>
        Number(b.total_balance_due || 0) - Number(a.total_balance_due || 0)
    )
    .slice(0, limit);
}

function scoreStockAlert(alert, businessRules) {
  let score = 0;

  const quantity = Number(alert.quantity || 0);
  const threshold = Number(alert.alert_threshold || 0);

  if (quantity <= 0) score += 5;
  if (quantity <= threshold) score += 3;

  if (isStrategicProduct(alert.product_name, businessRules)) score += 5;
  if (isPriorityCity(alert.city || alert.warehouse_city, businessRules)) score += 3;
  if (isPriorityChannel(alert.warehouse_name, businessRules)) score += 2;

  return score;
}

function getStrategicProductsFromTopProducts(topProducts = [], businessRules) {
  return topProducts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );
}

async function analyzeSalesOverview(businessRules) {
  const [stats, topProducts, topCustomers] = await Promise.all([
    getGlobalStats(),
    getTopProducts(10),
    getTopCustomers(10)
  ]);

  const totalSales = Number(stats?.total_sales_amount || 0);
  const totalCollected = Number(stats?.total_collected_amount || 0);
  const totalReceivables = Number(stats?.total_receivables || 0);

  const strategicProducts = getStrategicProductsFromTopProducts(
    topProducts,
    businessRules
  );

  const priorityCustomers = topCustomers.filter(
    (row) =>
      Number(row.total_balance_due || 0) > 0 &&
      isPriorityCity(row.city, businessRules)
  );

  const recommendations = [];

  if (strategicProducts.length > 0) {
    recommendations.push(
      "Sécuriser la disponibilité des produits stratégiques les plus vendeurs."
    );
  }

  if (priorityCustomers.length > 0) {
    recommendations.push(
      "Suivre en priorité les créances des clients situés dans les villes prioritaires."
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Maintenir la pression commerciale sur les produits à meilleure rotation."
    );
  }

  return {
    source_module: "sales",
    summary: `Les ventes cumulées s’élèvent à ${round2(totalSales)} USD.`,
    answer:
      `Le chiffre d’affaires cumulé est de ${round2(totalSales)} USD, avec ${round2(totalCollected)} USD encaissés et ${round2(totalReceivables)} USD encore en créances. ` +
      `Le pilotage doit rester centré sur les produits stratégiques et les canaux prioritaires de KIVU AGRO BIO.`,
    metrics: {
      total_sales_amount: round2(totalSales),
      total_collected_amount: round2(totalCollected),
      total_receivables: round2(totalReceivables),
      strategic_products_in_top_sales: strategicProducts.length,
      priority_customers_with_receivables: priorityCustomers.length
    },
    drivers: [
      ...strategicProducts.slice(0, 5).map(
        (row) =>
          `Produit stratégique en tête : ${row.product_name} (${Number(
            row.total_quantity_sold || 0
          )} unités vendues)`
      ),
      ...priorityCustomers.slice(0, 3).map(
        (row) =>
          `Client prioritaire avec créance : ${row.business_name} (${round2(
            row.total_balance_due
          )} USD)`
      )
    ],
    recommendations
  };
}

async function analyzeSalesVariance(businessRules) {
  const [invoices, topProducts, stockAlerts] = await Promise.all([
    getAllInvoices(),
    getTopProducts(10),
    getStockAlerts()
  ]);

  const totalInvoices = invoices.length;
  const totalSales = invoices.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );
  const totalBalanceDue = invoices.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );

  const strategicProducts = getStrategicProductsFromTopProducts(
    topProducts,
    businessRules
  );

  const strategicStockAlerts = stockAlerts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "sales",
    summary:
      "La variation des ventes doit être lue avec les produits stratégiques, le niveau de créances et les tensions de stock.",
    answer:
      `Sur les données actuelles, ${totalInvoices} factures représentent ${round2(totalSales)} USD de ventes et ${round2(totalBalanceDue)} USD de créances. ` +
      `Chez KIVU AGRO BIO, une baisse de performance commerciale doit être analysée d’abord sur les produits stratégiques et les canaux majeurs.`,
    metrics: {
      total_invoices: totalInvoices,
      total_sales_amount: round2(totalSales),
      total_receivables: round2(totalBalanceDue),
      strategic_products_count: strategicProducts.length,
      strategic_stock_alerts_count: strategicStockAlerts.length
    },
    drivers: [
      `Produits stratégiques présents parmi les meilleures ventes : ${strategicProducts.length}`,
      `Alertes stock touchant des produits stratégiques : ${strategicStockAlerts.length}`,
      `Créances ouvertes à suivre : ${round2(totalBalanceDue)} USD`
    ],
    recommendations: [
      "Analyser d’abord les ruptures touchant les produits stratégiques.",
      "Protéger les canaux structurants avant les canaux secondaires.",
      "Relancer en priorité les clients majeurs avec encours."
    ]
  };
}

async function analyzeStockPriority(businessRules) {
  const alerts = await getStockAlerts();

  const scored = [...alerts]
    .map((row) => ({
      ...row,
      priority_score: scoreStockAlert(row, businessRules)
    }))
    .sort((a, b) => Number(b.priority_score) - Number(a.priority_score));

  const criticalItems = scored.slice(0, 5);
  const strategicItems = scored.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "stock",
    summary:
      criticalItems.length > 0
        ? `${criticalItems.length} alertes stock prioritaires ont été identifiées.`
        : "Aucune alerte stock critique n’est détectée actuellement.",
    answer:
      criticalItems.length > 0
        ? "Le réapprovisionnement doit d’abord protéger les produits stratégiques et les villes prioritaires de KIVU AGRO BIO."
        : "Le stock ne présente pas de rupture critique immédiate selon les règles actuelles.",
    metrics: {
      critical_items_count: alerts.length,
      priority_items_count: criticalItems.length,
      strategic_items_in_alert: strategicItems.length
    },
    drivers: criticalItems.map(
      (row) =>
        `${row.product_name} - stock ${Number(row.quantity || 0)} / seuil ${Number(
          row.alert_threshold || 0
        )} - score ${Number(row.priority_score || 0)}`
    ),
    recommendations:
      criticalItems.length > 0
        ? [
            "Réapprovisionner en priorité les produits stratégiques en alerte.",
            "Arbitrer les stocks selon les villes prioritaires avant les autres zones.",
            "Contrôler les articles qui combinent forte rotation et stock inférieur au seuil."
          ]
        : [
            "Maintenir la surveillance des seuils et des produits stratégiques.",
            "Préparer les prochains besoins sur les références les plus vendues."
          ]
  };
}

async function analyzeReceivablesRisk(businessRules) {
  const topCustomers = await getTopCustomers(10);
  const risky = getTopReceivableCustomers(topCustomers, 10);

  const riskyPriorityCustomers = risky.filter((row) =>
    isPriorityCity(row.city, businessRules)
  );

  const totalReceivables = risky.reduce(
    (sum, row) => sum + Number(row.total_balance_due || 0),
    0
  );

  return {
    source_module: "customers",
    summary:
      risky.length > 0
        ? `Les principaux clients débiteurs concentrent ${round2(totalReceivables)} USD de créances.`
        : "Aucun client débiteur majeur n’a été identifié.",
    answer:
      risky.length > 0
        ? "Les clients situés dans les villes prioritaires doivent être traités en premier, car leur poids commercial est plus structurant pour KIVU AGRO BIO."
        : "Le portefeuille client ne montre pas de concentration forte des créances sur les données disponibles.",
    metrics: {
      risky_customers_count: risky.length,
      total_receivables_top_customers: round2(totalReceivables),
      risky_priority_customers_count: riskyPriorityCustomers.length
    },
    drivers: risky.slice(0, 5).map(
      (row) =>
        `${row.business_name} (${row.city || "ville inconnue"}) : ${round2(
          row.total_balance_due
        )} USD`
    ),
    recommendations:
      risky.length > 0
        ? [
            "Relancer d’abord les clients débiteurs des villes prioritaires.",
            "Limiter le crédit sur les comptes à encours répétés.",
            "Suivre les grands distributeurs sans casser la relation commerciale."
          ]
        : [
            "Maintenir un suivi régulier des créances.",
            "Conserver la discipline d’encaissement actuelle."
          ]
  };
}

async function analyzeExpenses(businessRules) {
  const expenses = await getAllExpenses();
  const topCategories = getTopExpenseCategories(expenses, 5);

  const totalExpenses = expenses.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const targetMargin = businessRules.target_net_margin_range || {
    min: 25,
    max: 30
  };

  return {
    source_module: "expenses",
    summary: `Les dépenses enregistrées totalisent ${round2(totalExpenses)} USD.`,
    answer:
      "Chez KIVU AGRO BIO, les dépenses doivent être lues non seulement par montant, mais aussi par utilité stratégique : distribution, acquisition commerciale, logistique et disponibilité produit.",
    metrics: {
      total_expenses: round2(totalExpenses),
      expense_count: expenses.length,
      target_net_margin_min: Number(targetMargin.min || 25),
      target_net_margin_max: Number(targetMargin.max || 30)
    },
    drivers: topCategories.map(
      (row) => `${row.category} : ${round2(row.total_amount)} USD`
    ),
    recommendations:
      topCategories.length > 0
        ? [
            "Réduire d’abord les charges peu liées à la distribution ou à la croissance.",
            "Tolérer davantage les dépenses qui soutiennent les canaux prioritaires et la disponibilité produit.",
            "Comparer les charges totales à la marge cible définie par KIVU AGRO BIO."
          ]
        : [
            "Continuer à structurer les catégories de dépense.",
            "Enrichir l’historique pour améliorer la lecture des charges."
          ]
  };
}

async function analyzeCashPosition(businessRules) {
  const stats = await getGlobalStats();

  const collected = Number(stats?.total_collected_amount || 0);
  const payments = Number(stats?.total_payments_received || 0);
  const receivables = Number(stats?.total_receivables || 0);
  const minimumCashThreshold = Number(
    businessRules.minimum_cash_threshold_usd || 3000
  );

  const pressure = collected < minimumCashThreshold;

  return {
    source_module: "cash",
    summary:
      `Les encaissements cumulés sont de ${round2(collected)} USD, avec ${round2(receivables)} USD encore à recouvrer.`,
    answer:
      pressure
        ? "Le niveau de liquidité observé est sous le seuil de vigilance métier défini pour KIVU AGRO BIO. Il faut protéger le cash à court terme."
        : "Le niveau de liquidité reste au-dessus du seuil minimal de vigilance actuellement défini.",
    metrics: {
      total_collected_amount: round2(collected),
      total_payments_received: round2(payments),
      total_receivables: round2(receivables),
      minimum_cash_threshold_usd: minimumCashThreshold
    },
    drivers: [
      `Encaissements cumulés : ${round2(collected)} USD`,
      `Créances ouvertes : ${round2(receivables)} USD`,
      `Seuil minimum cash : ${round2(minimumCashThreshold)} USD`
    ],
    recommendations: pressure
      ? [
          "Accélérer les encaissements sur les clients les plus exposés.",
          "Reporter les dépenses non urgentes.",
          "Réserver la trésorerie disponible aux stocks stratégiques et à la distribution."
        ]
      : [
          "Maintenir le niveau d’encaissement actuel.",
          "Surveiller les créances et éviter l’accumulation de charges peu stratégiques."
        ]
  };
}

async function analyzeAccounting() {
  const [stats, recentEntries] = await Promise.all([
    getAccountingGlobalStats(),
    getRecentJournalEntries(5)
  ]);

  return {
    source_module: "accounting",
    summary:
      `La comptabilité comporte ${Number(stats?.posted_entries || 0)} écritures validées et ${Number(stats?.draft_entries || 0)} brouillons.`,
    answer:
      "La lecture comptable immédiate repose sur le volume des écritures validées, l’équilibre débit/crédit et les derniers mouvements passés.",
    metrics: {
      total_accounts: Number(stats?.total_accounts || 0),
      total_entries: Number(stats?.total_entries || 0),
      posted_entries: Number(stats?.posted_entries || 0),
      draft_entries: Number(stats?.draft_entries || 0),
      total_posted_debit: round2(stats?.total_posted_debit || 0),
      total_posted_credit: round2(stats?.total_posted_credit || 0)
    },
    drivers: recentEntries.map(
      (row) => `${row.entry_number} - ${row.journal_code} - ${row.description}`
    ),
    recommendations: [
      "Surveiller les brouillons non validés.",
      "Contrôler régulièrement les journaux à plus forte fréquence."
    ]
  };
}

async function analyzeBusinessOverview(businessRules) {
  const [globalStats, accountingStats, stockAlerts] = await Promise.all([
    getGlobalStats(),
    getAccountingGlobalStats(),
    getStockAlerts()
  ]);

  const strategicStockAlerts = stockAlerts.filter((row) =>
    isStrategicProduct(row.product_name, businessRules)
  );

  return {
    source_module: "business",
    summary: "Vue synthétique de la situation commerciale, stock et comptable.",
    answer:
      `L’activité montre ${round2(globalStats?.total_sales_amount || 0)} USD de ventes cumulées, ${round2(globalStats?.total_receivables || 0)} USD de créances, ${Number(stockAlerts.length || 0)} alertes stock et ${Number(accountingStats?.posted_entries || 0)} écritures validées. ` +
      `Le pilotage doit se concentrer en priorité sur les produits et canaux structurants.`,
    metrics: {
      total_sales_amount: round2(globalStats?.total_sales_amount || 0),
      total_receivables: round2(globalStats?.total_receivables || 0),
      stock_alerts_count: Number(stockAlerts.length || 0),
      strategic_stock_alerts_count: strategicStockAlerts.length,
      posted_entries: Number(accountingStats?.posted_entries || 0)
    },
    drivers: [
      "Croiser ventes, stock, créances et comptabilité.",
      `Alertes stock sur produits stratégiques : ${strategicStockAlerts.length}`
    ],
    recommendations: [
      "Traiter d’abord les alertes stock qui touchent les produits stratégiques.",
      "Relancer les clients majeurs à créance élevée.",
      "Piloter les décisions à partir des données comptables déjà validées."
    ]
  };
}

function pushHistory(item) {
  aiHistory.unshift(item);

  if (aiHistory.length > 20) {
    aiHistory.pop();
  }
}

export async function askAIQuestion({ question, context = {} }) {
  const intentResult = detectIntent(question);
  const businessRules = await getBusinessRulesMap();

  const useReasoning =
    String(process.env.AI_REASONING_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false";

  if (useReasoning) {
    try {
      const contextData = await buildReasoningContextData();

      const reasoning = await runDeepseekReasoning({
        question,
        businessRules,
        contextData
      });

      const response = {
        intent: "ai_reasoning",
        period: "global",
        source_module: "ai_ceo",
        summary: reasoning.summary || "",
        answer: reasoning.analysis || "",
        metrics: {},
        drivers: [
          ...(reasoning.risks || []).map((item) => `Risque: ${item}`),
          ...(reasoning.opportunities || []).map(
            (item) => `Opportunité: ${item}`
          )
        ],
        recommendations: reasoning.recommendations || [],
        priority_level: reasoning.priority_level || "MEDIUM",
        confidence_score: 0.95,
        generated_at: new Date().toISOString()
      };

      pushHistory({
        question,
        intent: response.intent,
        summary: response.summary,
        created_at: response.generated_at
      });

      return response;
    } catch (error) {
      console.error("DeepSeek failed → fallback to existing engine:", error);
    }
  }

  let analysis;

  switch (intentResult.intent) {
    case "sales_overview":
      analysis = await analyzeSalesOverview(businessRules);
      break;
    case "sales_variance_explanation":
      analysis = await analyzeSalesVariance(businessRules);
      break;
    case "stock_priority_restock":
      analysis = await analyzeStockPriority(businessRules);
      break;
    case "customer_receivables_risk":
      analysis = await analyzeReceivablesRisk(businessRules);
      break;
    case "expense_pressure_analysis":
      analysis = await analyzeExpenses(businessRules);
      break;
    case "cash_position_analysis":
      analysis = await analyzeCashPosition(businessRules);
      break;
    case "accounting_summary":
      analysis = await analyzeAccounting();
      break;
    default:
      analysis = await analyzeBusinessOverview(businessRules);
      break;
  }

  const response = composeAIResponse({
    question,
    intentResult,
    analysis: {
      ...analysis,
      context,
      business_rules_applied: true
    }
  });

  pushHistory({
    question,
    intent: response.intent,
    summary: response.summary,
    created_at: response.generated_at
  });

  return response;
}

export function getQuickQuestions() {
  return quickQuestions;
}

export function getAIHistory() {
  return aiHistory;
}