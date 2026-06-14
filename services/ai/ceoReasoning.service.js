import { pool } from "../../config/db.js";
import { runDeepseekReasoning } from "./deepseekReasoner.service.js";
import { getBusinessRulesMap } from "./businessRules.service.js";
import { getActiveCompanyKnowledge } from "./companyKnowledge.service.js";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance
} from "../../models/accountingReport.model.js";
import {
  createPracticalAction,
  formatPracticalAction
} from "../../utils/practicalAI.util.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getEnvNumber(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10)
  };
}

function withTimeout(task, timeoutMs, label) {
  return Promise.race([
    task,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`${label} timed out after ${timeoutMs}ms`);
        error.code = "TIMEOUT";
        reject(error);
      }, timeoutMs);
    })
  ]);
}

async function getGlobalKpis() {
  const query = `
    WITH sales_base AS (
      SELECT
        COALESCE(SUM(i.total_amount), 0) AS total_sales_amount,
        COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS total_net_sales_amount,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected_amount,
        COALESCE(SUM(i.balance_due), 0) AS total_receivables
      FROM invoices i
      WHERE i.status IN ('issued', 'partial', 'paid')
    ),
    cogs_base AS (
      SELECT
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
    )
    SELECT
      sales_base.total_sales_amount,
      sales_base.total_net_sales_amount,
      sales_base.total_collected_amount,
      sales_base.total_receivables,
      cogs_base.total_cogs_amount,
      (sales_base.total_net_sales_amount - cogs_base.total_cogs_amount) AS gross_profit_amount,
      CASE
        WHEN sales_base.total_net_sales_amount > 0
          THEN ROUND(
            ((sales_base.total_net_sales_amount - cogs_base.total_cogs_amount)
              / sales_base.total_net_sales_amount) * 100,
            2
          )
        ELSE 0
      END AS gross_margin_percent
    FROM sales_base, cogs_base;
  `;

  const result = await pool.query(query);
  return result.rows[0] || {};
}

async function getCriticalReceivables(limit = 10) {
  const query = `
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.due_date,
      i.balance_due,
      i.total_amount,
      GREATEST(
        CURRENT_DATE - COALESCE(i.due_date, i.invoice_date),
        0
      )::int AS days_overdue,
      c.business_name AS customer_name,
      w.name AS warehouse_name
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    WHERE COALESCE(i.balance_due, 0) > 0
      AND i.status IN ('issued', 'partial')
    ORDER BY
      GREATEST(CURRENT_DATE - COALESCE(i.due_date, i.invoice_date), 0) DESC,
      i.balance_due DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

async function getLowMarginInvoices(limit = 10) {
  const query = `
    WITH invoice_cogs AS (
      SELECT
        ii.invoice_id,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount
      FROM invoice_items ii
      INNER JOIN products p ON p.id = ii.product_id
      GROUP BY ii.invoice_id
    )
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      c.business_name AS customer_name,
      COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0) AS net_sales_amount,
      COALESCE(ic.total_cogs_amount, 0) AS total_cogs_amount,
      (
        COALESCE(i.total_amount - COALESCE(i.tax_amount, 0), 0)
        - COALESCE(ic.total_cogs_amount, 0)
      ) AS gross_profit_amount
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
    WHERE i.status IN ('issued', 'partial', 'paid')
    ORDER BY gross_profit_amount ASC, i.invoice_date DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows.map((row) => {
    const net = Number(row.net_sales_amount || 0);
    const gp = Number(row.gross_profit_amount || 0);

    return {
      ...row,
      gross_margin_percent: net > 0 ? roundAmount((gp / net) * 100) : 0
    };
  });
}

async function getStockAlerts(limit = 10) {
  const query = `
    SELECT
      p.id AS product_id,
      ws.quantity,
      p.name AS product_name,
      p.sku,
      p.alert_threshold,
      w.name AS warehouse_name
    FROM warehouse_stock ws
    INNER JOIN products p ON p.id = ws.product_id
    INNER JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.quantity <= COALESCE(p.alert_threshold, 0)
    ORDER BY ws.quantity ASC, p.name ASC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

async function getTopProducts(limit = 10) {
  const query = `
    SELECT
      p.name AS product_name,
      p.sku,
      SUM(ii.quantity)::int AS total_quantity_sold,
      SUM(ii.line_total) AS total_sales_value,
      COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS total_cogs_amount,
      COALESCE(SUM(ii.line_total), 0) - COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS gross_profit_amount
    FROM invoice_items ii
    INNER JOIN products p ON p.id = ii.product_id
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status IN ('issued', 'partial', 'paid')
    GROUP BY p.name, p.sku
    ORDER BY total_sales_value DESC
    LIMIT $1;
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}

function compactKnowledgeRows(rows) {
  return rows.map((row) => ({
    key: row.knowledge_key,
    title: row.title,
    category: row.category,
    content: row.content,
    tags: row.tags || [],
    priority_level: row.priority_level,
    source_type: row.source_type
  }));
}

function buildCEOActionPlan(context) {
  const receivables = Array.isArray(context?.receivables)
    ? context.receivables
    : [];
  const stockAlerts = Array.isArray(context?.stock_alerts)
    ? context.stock_alerts
    : [];
  const lowMarginInvoices = Array.isArray(context?.low_margin_invoices)
    ? context.low_margin_invoices
    : [];
  const accounting = context?.accounting_reporting || {};
  const trialBalance = accounting.trial_balance || {};
  const actions = [];
  const topReceivable = receivables[0];
  const topStockAlert = stockAlerts[0];
  const topLowMargin = lowMarginInvoices[0];
  const accountingGap = Math.abs(
    Number(trialBalance.total_debit || 0) -
      Number(trialBalance.total_credit || 0)
  );

  if (topReceivable) {
    actions.push(
      createPracticalAction({
        id: `ceo-receivable-${topReceivable.id}`,
        domain: "receivables",
        priority: "critical",
        title: `Recouvrer ${topReceivable.customer_name}`,
        action: `Obtenir un paiement ou un engagement date sur la facture ${topReceivable.invoice_number}.`,
        rationale: `Encours prioritaire de ${roundAmount(topReceivable.balance_due)} USD, en retard de ${Number(topReceivable.days_overdue || 0)} jour(s).`,
        owner_role: "Responsable recouvrement",
        deadline_days: 0,
        amount_at_stake: topReceivable.balance_due,
        target_amount: topReceivable.balance_due,
        entity_type: "invoice",
        entity_id: topReceivable.id,
        entity_label: topReceivable.invoice_number,
        first_step:
          "Appeler le client aujourd'hui, confirmer le motif du retard et envoyer un engagement de paiement ecrit.",
        success_metric: "Paiement recu ou engagement date confirme par ecrit.",
        decision_required:
          "Suspendre ou maintenir le credit client jusqu'au paiement."
      })
    );
  }

  if (topStockAlert) {
    actions.push(
      createPracticalAction({
        id: `ceo-stock-${topStockAlert.product_id || topStockAlert.id}`,
        domain: "stock",
        priority: "high",
        title: `Securiser ${topStockAlert.product_name}`,
        action: "Verifier le besoin puis lancer un transfert ou un achat prioritaire.",
        rationale: `Stock disponible: ${roundAmount(topStockAlert.available_quantity || topStockAlert.quantity)}.`,
        owner_role: "Responsable stock et achats",
        deadline_days: 1,
        entity_type: "product",
        entity_id: topStockAlert.product_id || topStockAlert.id,
        entity_label: topStockAlert.product_name,
        first_step:
          "Verifier les stocks des autres depots et la consommation des 30 derniers jours.",
        success_metric: "Decision de transfert ou commande validee sous 24 heures.",
        decision_required: "Valider transfert inter-depots ou commande fournisseur."
      })
    );
  }

  if (topLowMargin) {
    actions.push(
      createPracticalAction({
        id: `ceo-margin-${topLowMargin.id}`,
        domain: "margin",
        priority: "high",
        title: `Corriger la marge de ${topLowMargin.invoice_number}`,
        action:
          "Verifier le prix, les remises et le cout de revient avant toute vente comparable.",
        rationale: `Facture identifiee parmi les plus faibles marges: ${roundAmount(topLowMargin.gross_margin_percent)} %.`,
        owner_role: "Direction commerciale et finance",
        deadline_days: 3,
        entity_type: "invoice",
        entity_id: topLowMargin.id,
        entity_label: topLowMargin.invoice_number,
        first_step:
          "Comparer prix facture, cout de revient et remise accordee ligne par ligne.",
        success_metric: "Nouveau prix plancher ou regle de remise validee.",
        decision_required: "Valider le prix plancher et la limite de remise."
      })
    );
  }

  if (accountingGap > 0.01) {
    actions.push(
      createPracticalAction({
        id: "ceo-accounting-gap",
        domain: "accounting",
        priority: "critical",
        title: "Corriger l'ecart comptable",
        action: "Identifier les ecritures responsables et retablir l'equilibre.",
        rationale: `Ecart detecte de ${roundAmount(accountingGap)} USD.`,
        owner_role: "Responsable comptable",
        deadline_days: 0,
        amount_at_stake: accountingGap,
        first_step:
          "Extraire les journaux desequilibres et rapprocher les totaux debit-credit.",
        success_metric: "Ecart de balance et de bilan egal a 0.",
        decision_required: "Valider les ecritures de correction avant cloture."
      })
    );
  }

  return actions.slice(0, 6);
}

function buildCEOQuestion() {
  return `
Tu es KABOT, assistant CEO de KIVU AGRO BIO.

Tu travailles pour la direction generale.
Tu dois raisonner comme un CEO/CFO operationnel.

Regles obligatoires :
- Base-toi uniquement sur les donnees fournies.
- N'invente aucun chiffre.
- Si une donnee manque, dis-le clairement.
- Reponds en francais professionnel.
- Sois concret, oriente decision, investisseur-ready.
- Chaque action doit preciser: responsable, echeance, montant ou objet, premiere etape et indicateur de succes.
- Distingue clairement ce qui doit etre fait aujourd'hui, cette semaine et ce qui exige une decision de direction.

Format de sortie JSON strict :
{
  "summary": "resume executif en 5 a 8 lignes",
  "priority_level": "CRITICAL | HIGH | MEDIUM | LOW",
  "confidence_score": 0.0,
  "alerts": ["..."],
  "opportunities": ["..."],
  "actions": ["..."],
  "metrics": {
    "metric_1": 0
  },
  "analysis": "analyse detaillee structuree"
}
`;
}

function buildFallbackCEOResponse(context) {
  const kpis = context?.kpis || {};
  const receivables = Array.isArray(context?.receivables)
    ? context.receivables
    : [];
  const stockAlerts = Array.isArray(context?.stock_alerts)
    ? context.stock_alerts
    : [];
  const topProducts = Array.isArray(context?.top_products)
    ? context.top_products
    : [];
  const accountingReporting = context?.accounting_reporting || {};
  const incomeStatement = accountingReporting.income_statement || {};
  const balanceSheet = accountingReporting.balance_sheet || {};
  const trialBalance = accountingReporting.trial_balance || {};
  const actionPlan = buildCEOActionPlan(context);
  const trialBalanceGap = roundAmount(
    Number(trialBalance.total_debit || 0) -
      Number(trialBalance.total_credit || 0)
  );

  const summary =
    `Ventes ${roundAmount(kpis.total_sales_amount)} USD, encaissements ${roundAmount(
      kpis.total_collected_amount
    )} USD, creances ${roundAmount(kpis.total_receivables)} USD. ` +
    `Resultat net ${roundAmount(incomeStatement.net_result)} USD et ecart debit-credit ${trialBalanceGap} USD. ` +
    `La direction doit surveiller en priorite la tresorerie, les encours clients, la coherence comptable et les alertes de stock.`;

  const analysis =
    `Les encaissements restent faibles par rapport aux ventes, ce qui accroit la tension sur le cash. ` +
    `Les creances prioritaires et les produits a faible stock doivent etre traites immediatement pour proteger la continuite operationnelle. ` +
    `Le reporting comptable montre ${roundAmount(incomeStatement.total_revenue)} USD de produits, ${roundAmount(incomeStatement.total_expense)} USD de charges et un ecart de balance de ${roundAmount(Number(trialBalance.total_debit || 0) - Number(trialBalance.total_credit || 0))} USD a surveiller si non nul.`;

  const recommendations = actionPlan.map(formatPracticalAction);

  return {
    intent: "ai_reasoning",
    period: "global",
    source_module: "ai_ceo",
    summary,
    answer: analysis,
    metrics: {
      total_sales_amount: roundAmount(kpis.total_sales_amount),
      total_collected_amount: roundAmount(kpis.total_collected_amount),
      total_receivables: roundAmount(kpis.total_receivables),
      total_revenue: roundAmount(incomeStatement.total_revenue),
      total_expense: roundAmount(incomeStatement.total_expense),
      net_result: roundAmount(incomeStatement.net_result),
      balance_sheet_gap: roundAmount(balanceSheet.gap),
      trial_balance_gap: trialBalanceGap
    },
    drivers: [
      ...receivables.slice(0, 3).map(
        (item) => `Risque: creance ${item.customer_name} ${roundAmount(item.balance_due)} USD`
      ),
      ...stockAlerts.slice(0, 2).map(
        (item) => `Risque: stock faible ${item.product_name}`
      ),
      ...topProducts.slice(0, 2).map(
        (item) => `Opportunite: produit porteur ${item.product_name}`
      )
    ],
    recommendations,
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
      today: actionPlan.filter((item) => item.deadline_days <= 1),
      this_week: actionPlan.filter((item) => item.deadline_days > 1),
      closure_rule:
        "Chaque action est cloturee avec un resultat chiffre ou une preuve de decision."
    },
    priority_level: "HIGH",
    confidence_score: 0.65,
    generated_at: new Date().toISOString()
  };
}

function isWeakCEOReasoning(reasoning) {
  const summary = String(reasoning?.summary || "").trim();
  const analysis = String(reasoning?.analysis || "").trim();
  const recommendations = Array.isArray(reasoning?.recommendations)
    ? reasoning.recommendations.length
    : 0;
  const actions = Array.isArray(reasoning?.actions) ? reasoning.actions.length : 0;

  return (
    !summary ||
    summary === "Analyse strategique generee." ||
    !analysis ||
    (recommendations === 0 && actions === 0)
  );
}

export async function getCEOBRIEF() {
  const ceoBudgetMs = Math.min(
    getEnvNumber("CEO_BRIEF_TIMEOUT_MS", 45000),
    55000
  );
  const range = currentMonthRange();

  const [
    globalKpis,
    criticalReceivables,
    lowMarginInvoices,
    stockAlerts,
    topProducts,
    incomeStatement,
    balanceSheet,
    trialBalance,
    companyKnowledge
  ] = await Promise.all([
    getGlobalKpis(),
    getCriticalReceivables(10),
    getLowMarginInvoices(10),
    getStockAlerts(10),
    getTopProducts(10),
    getIncomeStatement(range),
    getBalanceSheet(range),
    getTrialBalance(range),
    getActiveCompanyKnowledge({
      categories: ["company_profile", "strategy", "market", "operations"],
      limit: 30
    })
  ]);

  const context = {
    business_context: compactKnowledgeRows(companyKnowledge),
    kpis: globalKpis,
    receivables: criticalReceivables,
    low_margin_invoices: lowMarginInvoices,
    stock_alerts: stockAlerts,
    top_products: topProducts,
    accounting_reporting: {
      period: range,
      income_statement: incomeStatement?.totals || {},
      balance_sheet: balanceSheet?.totals || {},
      trial_balance: trialBalance?.totals || {}
    }
  };

  const businessRules = await getBusinessRulesMap();
  const useReasoning =
    String(process.env.AI_REASONING_ENABLED || "true")
      .trim()
      .toLowerCase() !== "false";

  if (!useReasoning) {
    return {
      rawData: context,
      ai: buildFallbackCEOResponse(context)
    };
  }

  try {
    const reasoning = await withTimeout(
      runDeepseekReasoning({
        question: buildCEOQuestion(),
        businessRules,
        contextData: context,
        profile: "ceo"
      }),
      ceoBudgetMs,
      "CEO brief reasoning"
    );

    if (!reasoning || isWeakCEOReasoning(reasoning)) {
      console.error("DeepSeek CEO profile returned weak payload, using rich fallback.");
      return {
        rawData: context,
        ai: buildFallbackCEOResponse(context)
      };
    }

    const actionPlan = buildCEOActionPlan(context);
    const aiResult = {
      intent: "ai_reasoning",
      period: "global",
      source_module: "ai_ceo",
      summary: reasoning.summary || "",
      answer: reasoning.analysis || "",
      metrics:
        reasoning.metrics && typeof reasoning.metrics === "object"
          ? reasoning.metrics
          : {},
      drivers: [
        ...(reasoning.risks || []).map((item) => `Risque: ${item}`),
        ...(reasoning.opportunities || []).map(
          (item) => `Opportunite: ${item}`
        )
      ],
      recommendations: actionPlan.map(formatPracticalAction),
      narrative_recommendations:
        reasoning.actions || reasoning.recommendations || [],
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
        today: actionPlan.filter((item) => item.deadline_days <= 1),
        this_week: actionPlan.filter((item) => item.deadline_days > 1),
        closure_rule:
          "Chaque action est cloturee avec un resultat chiffre ou une preuve de decision."
      },
      priority_level: reasoning.priority_level || "MEDIUM",
      confidence_score: reasoning.confidence_score || 0.95,
      generated_at: new Date().toISOString()
    };

    return {
      rawData: context,
      ai: aiResult
    };
  } catch (error) {
    console.error("DeepSeek CEO profile failed, using rich fallback:", error);

    return {
      rawData: context,
      ai: buildFallbackCEOResponse(context)
    };
  }
}
