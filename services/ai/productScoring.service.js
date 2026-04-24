import { getTopProducts, getStockAlerts } from "../../models/dashboard.model.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase();
}

function isStrategicProduct(productName, businessRules = {}) {
  const strategicProducts = Array.isArray(businessRules?.strategic_products)
    ? businessRules.strategic_products
    : [];

  const normalized = normalizeName(productName);

  return strategicProducts.some(
    (item) => normalizeName(item) === normalized
  );
}

export async function getProductScores(businessRules = {}) {
  const [topProducts, stockAlerts] = await Promise.all([
    getTopProducts(20),
    getStockAlerts()
  ]);

  const alertMap = new Map();

  for (const alert of Array.isArray(stockAlerts) ? stockAlerts : []) {
    if (!alert) {
      continue;
    }

    const key = String(alert.product_id || normalizeName(alert.product_name));
    const current = alertMap.get(key) || {
      alerts_count: 0,
      min_quantity: null,
      max_threshold: 0
    };

    current.alerts_count += 1;

    const quantity = Number(alert.quantity || 0);
    const threshold = Number(alert.alert_threshold || 0);

    if (current.min_quantity === null || quantity < current.min_quantity) {
      current.min_quantity = quantity;
    }

    if (threshold > current.max_threshold) {
      current.max_threshold = threshold;
    }

    alertMap.set(key, current);
  }

  const scoredProducts = (Array.isArray(topProducts) ? topProducts : [])
    .filter(Boolean)
    .map((product) => {
    const productName = product.product_name;
    const alertKey = String(product.product_id || normalizeName(productName));
    const salesQuantity = Number(product.total_quantity_sold || 0);
    const salesAmount = Number(
      product.total_sales_amount ?? product.total_sales_value ?? 0
    );
    const strategic = isStrategicProduct(productName, businessRules);
    const stockAlert = alertMap.get(alertKey) || null;

    let score = 0;

    score += Math.min(salesQuantity, 50);
    score += Math.min(Math.floor(salesAmount / 50), 30);

    if (strategic) score += 25;

    if (stockAlert) {
      score += 15;
      if (Number(stockAlert.min_quantity || 0) <= 0) {
        score += 20;
      }
    }

    let status = "normal";

    if (strategic && stockAlert) {
      status = "critical";
    } else if (strategic || stockAlert) {
      status = "priority";
    }

      return {
        product_id: product.product_id ?? null,
        product_name: productName,
        total_quantity_sold: salesQuantity,
        total_sales_amount: round2(salesAmount),
        is_strategic: strategic,
        stock_alerts_count: Number(stockAlert?.alerts_count || 0),
        min_alert_quantity:
          stockAlert && stockAlert.min_quantity !== null
            ? Number(stockAlert.min_quantity)
            : null,
        priority_score: score,
        status
      };
    });

  return scoredProducts.sort(
    (a, b) => Number(b.priority_score) - Number(a.priority_score)
  );
}
