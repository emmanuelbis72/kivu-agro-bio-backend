import { pool } from "../../config/db.js";
import { runDeepseekReasoning } from "./deepseekReasoner.service.js";
import { getBusinessRulesMap } from "./businessRules.service.js";
import { getActiveCompanyKnowledge } from "./companyKnowledge.service.js";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance
} from "../../models/accountingReport.model.js";

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
      i.balance_due,
      i.total_amount,
      c.business_name AS customer_name,
      w.name AS warehouse_name
    FROM invoices i
    INNER JOIN customers c ON c.id = i.customer_id
    INNER JOIN warehouses w ON w.id = i.warehouse_id
    WHERE COALESCE(i.balance_due, 0) > 0
    ORDER BY i.balance_due DESC, i.invoice_date ASC
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

  const summary =
    `Ventes ${roundAmount(kpis.total_sales_amount)} USD, encaissements ${roundAmount(
      kpis.total_collected_amount
    )} USD, creances ${roundAmount(kpis.total_receivables)} USD. ` +
    `Resultat net ${roundAmount(incomeStatement.net_result)} USD et ecart de bilan ${roundAmount(balanceSheet.gap)} USD. ` +
    `La direction doit surveiller en priorite la tresorerie, les encours clients, la coherence comptable et les alertes de stock.`;

  const analysis =
    `Les encaissements restent faibles par rapport aux ventes, ce qui accroit la tension sur le cash. ` +
    `Les creances prioritaires et les produits a faible stock doivent etre traites immediatement pour proteger la continuite operationnelle. ` +
    `Le reporting comptable montre ${roundAmount(incomeStatement.total_revenue)} USD de produits, ${roundAmount(incomeStatement.total_expense)} USD de charges et un ecart de balance de ${roundAmount(Number(trialBalance.total_debit || 0) - Number(trialBalance.total_credit || 0))} USD a surveiller si non nul.`;

  const recommendations = [
    "Accelerer le recouvrement des creances les plus elevees.",
    "Securiser les produits en alerte de stock.",
    "Controler les ecarts comptables et les brouillons avant cloture.",
    "Concentrer l'effort commercial sur les meilleures references."
  ];

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
      trial_balance_gap: roundAmount(
        Number(trialBalance.total_debit || 0) -
          Number(trialBalance.total_credit || 0)
      )
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
      recommendations: reasoning.actions || reasoning.recommendations || [],
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
