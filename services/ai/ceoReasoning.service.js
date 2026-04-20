import { pool } from "../../config/db.js";
import { askAIQuestion } from "./aiOrchestrator.service.js";
import { getActiveCompanyKnowledge } from "./companyKnowledge.service.js";

function roundAmount(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

Tu travailles pour la direction générale.
Tu dois raisonner comme un CEO/CFO opérationnel.

Règles obligatoires :
- Base-toi uniquement sur les données fournies.
- N’invente aucun chiffre.
- Si une donnée manque, dis-le clairement.
- Réponds en français professionnel.
- Sois concret, orienté décision, investisseur-ready.

Format de sortie JSON strict :
{
  "summary": "résumé exécutif en 5 à 8 lignes",
  "priority_level": "CRITICAL | HIGH | MEDIUM | LOW",
  "confidence_score": 0.0,
  "alerts": ["..."],
  "opportunities": ["..."],
  "actions": ["..."],
  "analysis": "analyse détaillée structurée"
}
`;
}

export async function getCEOBRIEF() {
  const [
    globalKpis,
    criticalReceivables,
    lowMarginInvoices,
    stockAlerts,
    topProducts,
    companyKnowledge
  ] = await Promise.all([
    getGlobalKpis(),
    getCriticalReceivables(10),
    getLowMarginInvoices(10),
    getStockAlerts(10),
    getTopProducts(10),
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
    top_products: topProducts
  };

  const aiResult = await askAIQuestion({
    question: buildCEOQuestion(),
    context
  });

  return {
    rawData: context,
    ai: aiResult
  };
}