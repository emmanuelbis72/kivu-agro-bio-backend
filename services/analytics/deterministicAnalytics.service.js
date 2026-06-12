import crypto from "crypto";
import { pool } from "../../config/db.js";

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function resolveAnalysisPeriod(period = "this_month", now = new Date()) {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  let start = new Date(end);
  let previousStart = new Date(end);
  let previousEnd = new Date(end);

  if (period === "today") {
    previousStart.setUTCDate(previousStart.getUTCDate() - 1);
    previousEnd = new Date(previousStart);
  } else if (period === "this_week") {
    const offset = start.getUTCDay() === 0 ? 6 : start.getUTCDay() - 1;
    start.setUTCDate(start.getUTCDate() - offset);
    previousEnd = new Date(start);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    previousStart = new Date(previousEnd);
    previousStart.setUTCDate(previousStart.getUTCDate() - 6);
  } else {
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    previousStart = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)
    );
    previousEnd = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 0)
    );
  }

  return {
    key: period,
    start_date: toIsoDate(start),
    end_date: toIsoDate(end),
    previous_start_date: toIsoDate(previousStart),
    previous_end_date: toIsoDate(previousEnd)
  };
}

function percentChange(current, previous) {
  const currentValue = Number(current || 0);
  const previousValue = Number(previous || 0);

  if (previousValue === 0) {
    return currentValue === 0 ? 0 : null;
  }

  return round(((currentValue - previousValue) / Math.abs(previousValue)) * 100);
}

export function calculateCollectionPriority({
  balance_due,
  days_overdue,
  historical_late_rate,
  payment_ratio,
  strategic_weight = 0
}) {
  const amountScore = Math.min(35, Math.max(0, Number(balance_due || 0) / 50));
  const latenessScore = Math.min(
    30,
    Math.max(0, Number(days_overdue || 0) * 0.75)
  );
  const historyScore = Math.min(
    15,
    Math.max(0, Number(historical_late_rate || 0) * 15)
  );
  const partialPaymentScore = Math.min(
    10,
    Math.max(0, (1 - Number(payment_ratio || 0)) * 10)
  );
  const score = round(
    Math.min(
      100,
      amountScore +
        latenessScore +
        historyScore +
        partialPaymentScore +
        Number(strategic_weight || 0)
    )
  );

  let priority = "monitor";
  let action = "Surveiller l'echeance et maintenir le suivi normal.";

  if (score >= 80) {
    priority = "critical";
    action = "Relancer aujourd'hui et faire valider toute nouvelle vente a credit.";
  } else if (score >= 60) {
    priority = "urgent";
    action = "Relancer aujourd'hui avec un engagement de paiement date.";
  } else if (score >= 40) {
    priority = "important";
    action = "Relancer cette semaine et verifier l'historique des paiements.";
  }

  return {
    score,
    priority,
    action,
    payment_likelihood_score: round(Math.max(5, 100 - score))
  };
}

export function weightedMovingAverage(values = []) {
  const cleanValues = values
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .slice(-3);

  if (cleanValues.length === 0) return 0;

  const weights = cleanValues.map((_, index) => index + 1);
  const weightedTotal = cleanValues.reduce(
    (sum, value, index) => sum + value * weights[index],
    0
  );
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  return round(weightedTotal / weightTotal);
}

async function getExecutiveSummary(period) {
  const result = await pool.query(
    `
      WITH invoice_cogs AS (
        SELECT
          ii.invoice_id,
          COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS cogs
        FROM invoice_items ii
        JOIN products p ON p.id = ii.product_id
        GROUP BY ii.invoice_id
      ),
      current_period AS (
        SELECT
          COUNT(*)::int AS invoice_count,
          COALESCE(SUM(i.total_amount), 0) AS revenue,
          COALESCE(SUM(i.total_amount - COALESCE(i.tax_amount, 0)), 0) AS net_sales,
          COALESCE(SUM(i.paid_amount), 0) AS collected,
          COALESCE(SUM(i.balance_due), 0) AS receivables,
          COALESCE(SUM(ic.cogs), 0) AS cogs,
          COALESCE(SUM(i.discount_amount), 0) AS discounts
        FROM invoices i
        LEFT JOIN invoice_cogs ic ON ic.invoice_id = i.id
        WHERE i.status IN ('issued','partial','paid')
          AND i.invoice_date BETWEEN $1::date AND $2::date
      ),
      previous_period AS (
        SELECT
          COALESCE(SUM(i.total_amount), 0) AS revenue,
          COALESCE(SUM(i.paid_amount), 0) AS collected
        FROM invoices i
        WHERE i.status IN ('issued','partial','paid')
          AND i.invoice_date BETWEEN $3::date AND $4::date
      ),
      expense_period AS (
        SELECT COALESCE(SUM(amount), 0) AS expenses
        FROM expenses
        WHERE expense_date BETWEEN $1::date AND $2::date
          AND archived_at IS NULL
      ),
      stock_value AS (
        SELECT
          COALESCE(SUM(ws.quantity * COALESCE(p.cost_price, 0)), 0) AS value,
          COUNT(*) FILTER (
            WHERE ws.quantity <= COALESCE(p.alert_threshold, 0)
          )::int AS low_stock_count
        FROM warehouse_stock ws
        JOIN products p ON p.id = ws.product_id
      ),
      overdue AS (
        SELECT
          COUNT(*)::int AS overdue_count,
          COALESCE(SUM(balance_due), 0) AS overdue_amount
        FROM invoices
        WHERE balance_due > 0
          AND due_date < CURRENT_DATE
          AND status IN ('issued','partial')
      )
      SELECT cp.*, pp.revenue AS previous_revenue,
        pp.collected AS previous_collected, ep.expenses,
        sv.value AS stock_value, sv.low_stock_count,
        od.overdue_count, od.overdue_amount
      FROM current_period cp, previous_period pp, expense_period ep,
        stock_value sv, overdue od;
    `,
    [
      period.start_date,
      period.end_date,
      period.previous_start_date,
      period.previous_end_date
    ]
  );

  const row = result.rows[0] || {};
  const grossProfit = Number(row.net_sales || 0) - Number(row.cogs || 0);
  const estimatedNetProfit = grossProfit - Number(row.expenses || 0);

  return {
    revenue: round(row.revenue),
    net_sales: round(row.net_sales),
    collected: round(row.collected),
    receivables: round(row.receivables),
    cogs: round(row.cogs),
    discounts: round(row.discounts),
    gross_profit: round(grossProfit),
    gross_margin_percent:
      Number(row.net_sales || 0) > 0
        ? round((grossProfit / Number(row.net_sales)) * 100)
        : 0,
    operating_expenses: round(row.expenses),
    estimated_net_profit: round(estimatedNetProfit),
    estimated_net_margin_percent:
      Number(row.net_sales || 0) > 0
        ? round((estimatedNetProfit / Number(row.net_sales)) * 100)
        : 0,
    invoice_count: Number(row.invoice_count || 0),
    stock_value: round(row.stock_value),
    low_stock_count: Number(row.low_stock_count || 0),
    overdue_invoice_count: Number(row.overdue_count || 0),
    overdue_receivables: round(row.overdue_amount),
    revenue_change_percent: percentChange(row.revenue, row.previous_revenue),
    collections_change_percent: percentChange(
      row.collected,
      row.previous_collected
    )
  };
}

async function getSalesTrend(period) {
  const result = await pool.query(
    `
      SELECT
        TO_CHAR(DATE_TRUNC('month', invoice_date), 'YYYY-MM') AS period,
        COUNT(*)::int AS invoice_count,
        COALESCE(SUM(total_amount), 0) AS revenue,
        COALESCE(SUM(paid_amount), 0) AS collected,
        COALESCE(SUM(balance_due), 0) AS receivables
      FROM invoices
      WHERE status IN ('issued','partial','paid')
        AND invoice_date >= ($1::date - INTERVAL '8 months')
        AND invoice_date <= $2::date
      GROUP BY DATE_TRUNC('month', invoice_date)
      ORDER BY DATE_TRUNC('month', invoice_date);
    `,
    [period.start_date, period.end_date]
  );

  return result.rows.map((row) => ({
    period: row.period,
    invoice_count: Number(row.invoice_count || 0),
    revenue: round(row.revenue),
    collected: round(row.collected),
    receivables: round(row.receivables)
  }));
}

async function getProfitability(period) {
  const result = await pool.query(
    `
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.category,
        SUM(ii.quantity) AS quantity_sold,
        SUM(ii.line_total) AS revenue,
        SUM(ii.quantity * COALESCE(p.cost_price, 0)) AS cogs,
        SUM(ii.line_total - (ii.quantity * COALESCE(p.cost_price, 0))) AS gross_profit
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued','partial','paid')
        AND i.invoice_date BETWEEN $1::date AND $2::date
      GROUP BY p.id, p.name, p.category
      ORDER BY gross_profit DESC, revenue DESC
      LIMIT 20;
    `,
    [period.start_date, period.end_date]
  );

  return result.rows.map((row) => {
    const revenue = Number(row.revenue || 0);
    const grossProfit = Number(row.gross_profit || 0);

    return {
      product_id: Number(row.product_id),
      product_name: row.product_name,
      category: row.category,
      quantity_sold: round(row.quantity_sold),
      revenue: round(revenue),
      cogs: round(row.cogs),
      gross_profit: round(grossProfit),
      gross_margin_percent: revenue > 0 ? round((grossProfit / revenue) * 100) : 0,
      at_loss: grossProfit < 0
    };
  });
}

async function getCollectionPriorities() {
  const result = await pool.query(
    `
      WITH payment_summary AS (
        SELECT
          i.customer_id,
          COUNT(i.id)::int AS historical_invoice_count,
          COUNT(i.id) FILTER (
            WHERE i.due_date IS NOT NULL
              AND COALESCE(lp.last_payment_date, CURRENT_DATE) > i.due_date
          )::int AS late_invoice_count,
          COALESCE(SUM(i.paid_amount), 0) AS historical_paid,
          COALESCE(SUM(i.total_amount), 0) AS historical_billed
        FROM invoices i
        LEFT JOIN (
          SELECT invoice_id, MAX(payment_date) AS last_payment_date
          FROM payments
          GROUP BY invoice_id
        ) lp ON lp.invoice_id = i.id
        WHERE i.status IN ('issued','partial','paid')
        GROUP BY i.customer_id
      )
      SELECT
        i.id AS invoice_id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        i.total_amount,
        i.paid_amount,
        i.balance_due,
        GREATEST(CURRENT_DATE - i.due_date, 0)::int AS days_overdue,
        c.id AS customer_id,
        c.business_name AS customer_name,
        c.city,
        c.chain_name,
        c.sales_channel,
        c.commercial_name,
        w.name AS warehouse_name,
        COALESCE(ps.historical_invoice_count, 0) AS historical_invoice_count,
        COALESCE(ps.late_invoice_count, 0) AS late_invoice_count,
        CASE
          WHEN COALESCE(ps.historical_invoice_count, 0) > 0
            THEN ps.late_invoice_count::numeric / ps.historical_invoice_count
          ELSE 0
        END AS historical_late_rate,
        CASE
          WHEN COALESCE(ps.historical_billed, 0) > 0
            THEN ps.historical_paid / ps.historical_billed
          ELSE 0
        END AS payment_ratio
      FROM invoices i
      JOIN customers c ON c.id = i.customer_id
      JOIN warehouses w ON w.id = i.warehouse_id
      LEFT JOIN payment_summary ps ON ps.customer_id = i.customer_id
      WHERE i.balance_due > 0
        AND i.status IN ('issued','partial')
      ORDER BY i.balance_due DESC, i.due_date ASC;
    `
  );

  return result.rows
    .map((row) => {
      const score = calculateCollectionPriority({
        balance_due: row.balance_due,
        days_overdue: row.days_overdue,
        historical_late_rate: row.historical_late_rate,
        payment_ratio: row.payment_ratio,
        strategic_weight: row.chain_name ? 5 : 0
      });

      return {
        invoice_id: Number(row.invoice_id),
        invoice_number: row.invoice_number,
        customer_id: Number(row.customer_id),
        customer_name: row.customer_name,
        point_of_sale: row.warehouse_name,
        city: row.city,
        commercial_name: row.commercial_name,
        invoice_date: row.invoice_date,
        due_date: row.due_date,
        initial_amount: round(row.total_amount),
        paid_amount: round(row.paid_amount),
        balance_due: round(row.balance_due),
        days_overdue: Number(row.days_overdue || 0),
        historical_invoice_count: Number(row.historical_invoice_count || 0),
        historical_late_rate: round(Number(row.historical_late_rate || 0) * 100),
        historical_payment_ratio: round(Number(row.payment_ratio || 0) * 100),
        ...score
      };
    })
    .sort((left, right) => right.score - left.score);
}

async function getStockCoverage() {
  const result = await pool.query(
    `
      WITH sales_90d AS (
        SELECT
          ii.product_id,
          i.warehouse_id,
          COALESCE(SUM(ii.quantity), 0) AS quantity_sold
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.status IN ('issued','partial','paid')
          AND i.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY ii.product_id, i.warehouse_id
      )
      SELECT
        ws.product_id,
        p.name AS product_name,
        p.category,
        ws.warehouse_id,
        w.name AS warehouse_name,
        w.city,
        ws.quantity,
        p.alert_threshold,
        COALESCE(s.quantity_sold, 0) AS quantity_sold_90d
      FROM warehouse_stock ws
      JOIN products p ON p.id = ws.product_id
      JOIN warehouses w ON w.id = ws.warehouse_id
      LEFT JOIN sales_90d s
        ON s.product_id = ws.product_id
       AND s.warehouse_id = ws.warehouse_id
      ORDER BY p.name, w.name;
    `
  );

  return result.rows
    .map((row) => {
      const averageDailySales = Number(row.quantity_sold_90d || 0) / 90;
      const stock = Number(row.quantity || 0);
      const coverageDays =
        averageDailySales > 0 ? stock / averageDailySales : null;
      const targetStock = averageDailySales * 30;
      const reorderQuantity = Math.max(0, targetStock - stock);

      return {
        product_id: Number(row.product_id),
        product_name: row.product_name,
        category: row.category,
        warehouse_id: Number(row.warehouse_id),
        warehouse_name: row.warehouse_name,
        city: row.city,
        stock_quantity: round(stock),
        alert_threshold: Number(row.alert_threshold || 0),
        quantity_sold_90d: round(row.quantity_sold_90d),
        average_daily_sales: round(averageDailySales, 3),
        coverage_days: coverageDays === null ? null : round(coverageDays, 1),
        recommended_reorder_quantity: round(reorderQuantity),
        status:
          stock <= Number(row.alert_threshold || 0)
            ? "critical"
            : coverageDays !== null && coverageDays < 10
              ? "urgent"
              : coverageDays !== null && coverageDays < 20
                ? "watch"
                : "healthy"
      };
    })
    .sort((left, right) => {
      const priority = { critical: 4, urgent: 3, watch: 2, healthy: 1 };
      return priority[right.status] - priority[left.status];
    });
}

function buildForecast(trend) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const completedTrend = trend.filter((row) => row.period < currentMonth);
  const forecastTrend = completedTrend.length >= 3 ? completedTrend : trend;
  const values = forecastTrend.map((row) => row.revenue);
  const projectedRevenue = weightedMovingAverage(values);
  const recentActual = values.slice(-4);
  const errors = [];

  for (let index = 3; index < recentActual.length; index += 1) {
    const predicted = weightedMovingAverage(recentActual.slice(index - 3, index));
    const actual = recentActual[index];
    if (actual > 0) errors.push(Math.abs((actual - predicted) / actual) * 100);
  }

  const marginOfError = errors.length
    ? round(errors.reduce((sum, value) => sum + value, 0) / errors.length)
    : 25;
  const confidence = round(Math.max(40, 100 - marginOfError));

  return {
    method: "Moyenne mobile ponderee sur les trois derniers mois (poids 1-2-3)",
    projected_revenue: projectedRevenue,
    prudent_projection: round(projectedRevenue * (1 - marginOfError / 100)),
    optimistic_projection: round(projectedRevenue * (1 + marginOfError / 100)),
    confidence_score: confidence,
    margin_of_error_percent: marginOfError,
    observations_used: Math.min(values.length, 3),
    periods_used: forecastTrend.slice(-3).map((row) => row.period),
    excludes_incomplete_current_month: completedTrend.length >= 3
  };
}

function buildRecommendations({ metrics, collections, stock, profitability }) {
  const recommendations = [];
  const criticalDebt = collections.filter((row) =>
    ["critical", "urgent"].includes(row.priority)
  );
  const criticalStock = stock.filter((row) =>
    ["critical", "urgent"].includes(row.status)
  );
  const lossProducts = profitability.filter((row) => row.at_loss);

  if (criticalDebt.length) {
    recommendations.push({
      priority: "urgent",
      title: "Accelerer le recouvrement",
      justification: `${criticalDebt.length} facture(s) ont un score de recouvrement urgent ou critique pour ${round(
        criticalDebt.reduce((sum, row) => sum + row.balance_due, 0)
      )} USD.`,
      action: "Traiter les dossiers classes en tete du tableau de recouvrement."
    });
  }

  if (criticalStock.length) {
    recommendations.push({
      priority: "urgent",
      title: "Proteger la disponibilite produit",
      justification: `${criticalStock.length} ligne(s) de stock sont critiques ou sous 10 jours de couverture.`,
      action: "Reapprovisionner selon la quantite recommandee ou transferer le stock disponible."
    });
  }

  if (lossProducts.length) {
    recommendations.push({
      priority: "important",
      title: "Corriger les ventes a perte",
      justification: `${lossProducts.length} produit(s) presentent une marge brute negative sur la periode.`,
      action: "Verifier prix, remises et couts de revient avant la prochaine vente."
    });
  }

  if (Number(metrics.estimated_net_margin_percent || 0) < 20) {
    recommendations.push({
      priority: "important",
      title: "Restaurer la marge estimee",
      justification: `La marge nette estimee est de ${metrics.estimated_net_margin_percent} %.`,
      action: "Analyser les depenses dominantes et ajuster les prix des produits a faible marge."
    });
  }

  return recommendations.slice(0, 8);
}

export async function runDeterministicAnalysis({
  intent = "business_overview",
  period = "this_month"
} = {}) {
  const resolvedPeriod = resolveAnalysisPeriod(period);
  const [
    metrics,
    trend,
    profitability,
    collections,
    stock
  ] = await Promise.all([
    getExecutiveSummary(resolvedPeriod),
    getSalesTrend(resolvedPeriod),
    getProfitability(resolvedPeriod),
    getCollectionPriorities(),
    getStockCoverage()
  ]);
  const forecast = buildForecast(trend);
  const recommendations = buildRecommendations({
    metrics,
    collections,
    stock,
    profitability
  });

  const tables = [
    {
      id: "profitability_by_product",
      title: "Rentabilite brute par produit",
      rows: profitability
    },
    {
      id: "collection_priorities",
      title: "Priorisation deterministe des recouvrements",
      rows: collections.slice(0, 50)
    },
    {
      id: "stock_coverage",
      title: "Couverture et recommandations de stock",
      rows: stock.slice(0, 100)
    },
    {
      id: "sales_trend",
      title: "Evolution mensuelle des ventes",
      rows: trend
    }
  ];

  return {
    analysis_id: `analysis_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    engine: {
      name: "kivu_deterministic_analytics",
      version: "1.0.0",
      nature: "deterministic"
    },
    intent,
    period: resolvedPeriod,
    generated_at: new Date().toISOString(),
    metrics: {
      ...metrics,
      forecast_next_month_revenue: forecast.projected_revenue,
      forecast_confidence_score: forecast.confidence_score,
      critical_collection_count: collections.filter(
        (row) => row.priority === "critical"
      ).length,
      urgent_stock_count: stock.filter((row) =>
        ["critical", "urgent"].includes(row.status)
      ).length
    },
    tables,
    charts: [
      {
        id: "sales_collections_trend",
        type: "line",
        title: "Ventes et encaissements mensuels",
        data: trend,
        x_key: "period",
        series: [
          { key: "revenue", label: "Chiffre d'affaires", unit: "USD" },
          { key: "collected", label: "Encaissements", unit: "USD" }
        ]
      },
      {
        id: "product_profitability",
        type: "bar",
        title: "Marge brute par produit",
        data: profitability.slice(0, 10),
        x_key: "product_name",
        series: [{ key: "gross_profit", label: "Marge brute", unit: "USD" }]
      },
      {
        id: "receivables_priority",
        type: "bar",
        title: "Creances prioritaires",
        data: collections.slice(0, 10),
        x_key: "customer_name",
        series: [{ key: "balance_due", label: "Solde du", unit: "USD" }]
      }
    ],
    forecast,
    recommendations,
    methodology: [
      "Les montants proviennent de requetes SQL agregees sur les donnees enregistrees.",
      "La marge brute utilise le cout de revient actuel du catalogue.",
      "La marge nette est une estimation: marge brute moins les depenses de la periode.",
      "Le score de recouvrement combine montant, retard, comportement historique et paiements partiels.",
      forecast.method
    ],
    sources: [
      { table: "invoices", purpose: "ventes, creances et echeances" },
      { table: "invoice_items", purpose: "quantites et chiffre d'affaires produit" },
      { table: "payments", purpose: "encaissements et comportement de paiement" },
      { table: "products", purpose: "couts de revient et seuils de stock" },
      { table: "warehouse_stock", purpose: "stock disponible par depot" },
      { table: "expenses", purpose: "charges de la periode" },
      { table: "customers", purpose: "client, ville, canal et commercial" },
      { table: "warehouses", purpose: "depot et ville" }
    ],
    data_quality: {
      status: "partial",
      warnings: [
        "Les couts logistiques, pertes et commissions ne sont pas encore affectes a chaque ligne de vente.",
        "Le cout de revient utilise est le cout actuel du produit, faute d'historique de cout par ligne.",
        "La probabilite de paiement est un score explicable, pas un modele statistique calibre.",
        "Les previsions saisonnieres restent limitees par un historique commercial inferieur a douze mois."
      ]
    }
  };
}
