import { pool } from "../../config/db.js";
import { isStrategicProduct } from "./businessRules.service.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function priorityLevel(score, coverageDays) {
  if (coverageDays !== null && coverageDays <= 7) return "critical";
  if (score >= 70 || (coverageDays !== null && coverageDays <= 15)) return "high";
  if (score >= 40 || (coverageDays !== null && coverageDays <= 30)) return "watch";
  return "normal";
}

export async function getProductScores(businessRules = {}) {
  const result = await pool.query(`
    WITH sales_90d AS (
      SELECT
        ii.product_id,
        COALESCE(SUM(ii.quantity), 0) AS quantity_sold_90d,
        COALESCE(SUM(ii.line_total), 0) AS sales_amount_90d,
        COALESCE(SUM(ii.quantity * COALESCE(p.cost_price, 0)), 0) AS cogs_90d
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN products p ON p.id = ii.product_id
      WHERE i.status IN ('issued', 'partial', 'paid')
        AND i.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY ii.product_id
    ),
    stock AS (
      SELECT
        ws.product_id,
        COALESCE(SUM(ws.quantity), 0) AS stock_quantity,
        MIN(ws.quantity) AS min_alert_quantity,
        COUNT(*) FILTER (
          WHERE ws.quantity <= COALESCE(p.alert_threshold, 0)
        )::int AS stock_alerts_count,
        COUNT(*) FILTER (WHERE ws.quantity <= 0)::int AS stockout_locations
      FROM warehouse_stock ws
      INNER JOIN products p ON p.id = ws.product_id
      GROUP BY ws.product_id
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(s.quantity_sold_90d, 0) AS quantity_sold_90d,
      COALESCE(s.sales_amount_90d, 0) AS sales_amount_90d,
      COALESCE(s.cogs_90d, 0) AS cogs_90d,
      COALESCE(st.stock_quantity, 0) AS stock_quantity,
      st.min_alert_quantity,
      COALESCE(st.stock_alerts_count, 0) AS stock_alerts_count,
      COALESCE(st.stockout_locations, 0) AS stockout_locations
    FROM products p
    LEFT JOIN sales_90d s ON s.product_id = p.id
    LEFT JOIN stock st ON st.product_id = p.id
    WHERE p.archived_at IS NULL
      AND p.is_active = TRUE
    ORDER BY sales_amount_90d DESC, p.name ASC;
  `);

  const maximumSales = Math.max(
    1,
    ...result.rows.map((row) => Number(row.sales_amount_90d || 0))
  );

  return result.rows
    .map((row) => {
      const quantitySold = Number(row.quantity_sold_90d || 0);
      const salesAmount = Number(row.sales_amount_90d || 0);
      const cogs = Number(row.cogs_90d || 0);
      const grossProfit = salesAmount - cogs;
      const marginPercent =
        salesAmount > 0 ? (grossProfit / salesAmount) * 100 : 0;
      const stockQuantity = Number(row.stock_quantity || 0);
      const averageDailySales = quantitySold / 90;
      const coverageDays =
        averageDailySales > 0 ? stockQuantity / averageDailySales : null;
      const reorderQuantity = Math.max(
        0,
        Math.ceil(averageDailySales * 30 - stockQuantity)
      );
      const strategic = isStrategicProduct(row.product_name, businessRules);
      const demandScore = Math.min(30, (salesAmount / maximumSales) * 30);
      const marginScore =
        marginPercent >= 30 ? 15 : marginPercent >= 20 ? 10 : marginPercent > 0 ? 5 : 0;
      const stockRiskScore =
        coverageDays === null
          ? 0
          : coverageDays <= 7
            ? 45
            : coverageDays <= 15
              ? 35
              : coverageDays <= 30
                ? 20
                : 0;
      const stockoutScore = Math.min(
        10,
        Number(row.stockout_locations || 0) * 5
      );
      const priorityScore = clampScore(
        demandScore +
          marginScore +
          stockRiskScore +
          stockoutScore +
          (strategic ? 10 : 0)
      );
      const level = priorityLevel(priorityScore, coverageDays);
      const needsAction = reorderQuantity > 0 && quantitySold > 0;

      return {
        product_id: Number(row.product_id),
        product_name: row.product_name,
        sku: row.sku,
        category: row.category,
        total_quantity_sold: round2(quantitySold),
        quantity_sold_90d: round2(quantitySold),
        total_sales_amount: round2(salesAmount),
        sales_amount_90d: round2(salesAmount),
        gross_profit_amount: round2(grossProfit),
        gross_margin_percent: round2(marginPercent),
        stock_quantity: round2(stockQuantity),
        min_alert_quantity:
          row.min_alert_quantity === null
            ? null
            : round2(row.min_alert_quantity),
        average_daily_sales: round2(averageDailySales),
        coverage_days: coverageDays === null ? null : round2(coverageDays),
        recommended_reorder_quantity: reorderQuantity,
        stock_alerts_count: Number(row.stock_alerts_count || 0),
        stockout_locations: Number(row.stockout_locations || 0),
        is_strategic: strategic,
        priority_score: priorityScore,
        intelligence_score: priorityScore,
        priority_level: level,
        status: level,
        score_breakdown: {
          demand: round2(demandScore),
          margin: round2(marginScore),
          stock_risk: round2(stockRiskScore),
          stockout: round2(stockoutScore),
          strategic: strategic ? 10 : 0
        },
        explanation:
          `Priorite ${priorityScore}/100: ventes 90 jours ${round2(salesAmount)} USD, ` +
          `marge ${round2(marginPercent)} %, stock ${round2(stockQuantity)}, ` +
          `couverture ${coverageDays === null ? "non calculable" : `${round2(coverageDays)} jours`}.`,
        owner_role: needsAction ? "Stock / Achats" : "Direction commerciale",
        deadline_days: level === "critical" ? 0 : level === "high" ? 2 : 7,
        recommendation: needsAction
          ? `Commander ou transferer ${reorderQuantity} unite(s) pour viser 30 jours de couverture.`
          : marginPercent < 15 && salesAmount > 0
            ? "Revoir le prix ou le cout avant d'accelerer les ventes."
            : "Maintenir la disponibilite et suivre la rotation chaque semaine.",
        first_step: needsAction
          ? "Verifier le stock physique et les disponibilites dans les autres depots."
          : "Verifier la marge et la rotation lors de la revue commerciale.",
        success_metric: needsAction
          ? "Couverture de stock ramenee a au moins 20 jours."
          : "Marge et disponibilite maintenues au niveau cible."
      };
    })
    .sort((left, right) => right.priority_score - left.priority_score);
}
