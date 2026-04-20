import { getAllInvoices } from "../../models/invoice.model.js";
import { getTopProducts, getTopCustomers, getStockAlerts } from "../../models/dashboard.model.js";
import {
  getBusinessRulesMap,
  isPriorityCity,
  isPriorityChannel,
  isStrategicProduct
} from "./businessRules.service.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeScore(score) {
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

function scoreLabel(score) {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 35) return "MEDIUM";
  return "LOW";
}

function daysBetween(dateValue) {
  if (!dateValue) return 0;

  const input = new Date(dateValue);
  const now = new Date();

  if (Number.isNaN(input.getTime())) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor((now.getTime() - input.getTime()) / (1000 * 60 * 60 * 24))
  );
}

export async function getCustomerRiskScoring() {
  const businessRules = await getBusinessRulesMap();
  const [topCustomers, invoices] = await Promise.all([
    getTopCustomers(50),
    getAllInvoices()
  ]);

  const invoicesByCustomer = new Map();

  for (const invoice of invoices) {
    const customerId = Number(invoice.customer_id || 0);
    if (!customerId) continue;

    if (!invoicesByCustomer.has(customerId)) {
      invoicesByCustomer.set(customerId, []);
    }

    invoicesByCustomer.get(customerId).push(invoice);
  }

  const rows = topCustomers.map((customer) => {
    const customerInvoices = invoicesByCustomer.get(Number(customer.customer_id)) || [];
    const totalDue = Number(customer.total_balance_due || 0);
    const totalBilled = Number(customer.total_billed || 0);

    let score = 0;

    if (totalDue > 0) score += 20;
    if (totalDue > 500) score += 10;
    if (totalDue > 1000) score += 15;

    const overdue30 = customerInvoices.filter(
      (invoice) =>
        Number(invoice.balance_due || 0) > 0 &&
        daysBetween(invoice.invoice_date) >= 30
    ).length;

    const overdue60 = customerInvoices.filter(
      (invoice) =>
        Number(invoice.balance_due || 0) > 0 &&
        daysBetween(invoice.invoice_date) > 60
    ).length;

    score += overdue30 * 8;
    score += overdue60 * 12;

    if (isPriorityCity(customer.city, businessRules)) {
      score += 8;
    }

    if (totalBilled > 5000) score += 8;
    if (totalBilled > 10000) score += 10;

    const finalScore = normalizeScore(score);

    return {
      customer_id: customer.customer_id,
      business_name: customer.business_name,
      city: customer.city,
      total_invoices: Number(customer.total_invoices || 0),
      total_billed: round2(totalBilled),
      total_paid: round2(customer.total_paid || 0),
      total_balance_due: round2(totalDue),
      overdue_30_count: overdue30,
      overdue_60_count: overdue60,
      risk_score: finalScore,
      risk_level: scoreLabel(finalScore),
      recommendation:
        finalScore >= 80
          ? "Client sous surveillance critique : limiter le crédit et relancer immédiatement."
          : finalScore >= 60
          ? "Client risqué : suivre activement les encaissements et encadrer les nouvelles ventes à crédit."
          : finalScore >= 35
          ? "Client à surveiller : maintenir un suivi régulier."
          : "Risque faible : relation commerciale acceptable sous contrôle normal."
    };
  });

  return rows.sort((a, b) => b.risk_score - a.risk_score);
}

export async function getProductIntelligenceScoring() {
  const businessRules = await getBusinessRulesMap();
  const [topProducts, stockAlerts, invoices] = await Promise.all([
    getTopProducts(100),
    getStockAlerts(),
    getAllInvoices()
  ]);

  const invoiceIndex = new Map();
  for (const invoice of invoices) {
    invoiceIndex.set(Number(invoice.id), invoice);
  }

  const stockAlertSet = new Set(
    stockAlerts.map((item) => `${item.product_id}_${item.warehouse_id}`)
  );

  const rows = topProducts.map((product) => {
    const sales = Number(product.total_sales_value || 0);
    const gp = Number(product.gross_profit_amount || 0);
    const qty = Number(product.total_quantity_sold || 0);
    const margin = sales > 0 ? (gp / sales) * 100 : 0;

    let score = 0;

    if (isStrategicProduct(product.product_name, businessRules)) score += 30;
    if (qty > 20) score += 15;
    if (qty > 50) score += 10;
    if (sales > 500) score += 10;
    if (sales > 1500) score += 10;
    if (margin >= 25) score += 15;
    else if (margin >= 15) score += 8;
    else if (margin < 10) score -= 10;

    const hasStockAlert = stockAlerts.some(
      (item) => Number(item.product_id) === Number(product.product_id)
    );

    if (hasStockAlert) score += 10;

    const finalScore = normalizeScore(score);

    return {
      product_id: product.product_id,
      product_name: product.product_name,
      sku: product.sku,
      total_quantity_sold: qty,
      total_sales_value: round2(sales),
      total_cogs_amount: round2(product.total_cogs_amount || 0),
      gross_profit_amount: round2(gp),
      gross_margin_percent: round2(margin),
      has_stock_alert: hasStockAlert,
      strategic_product: isStrategicProduct(product.product_name, businessRules),
      intelligence_score: finalScore,
      intelligence_level: scoreLabel(finalScore),
      recommendation:
        finalScore >= 80
          ? "Produit à protéger en priorité : forte importance commerciale et/ou stratégique."
          : finalScore >= 60
          ? "Produit important : maintenir disponibilité et suivi rapproché."
          : finalScore >= 35
          ? "Produit utile : suivre sa rotation et sa marge."
          : "Produit secondaire : arbitrer selon marge, rotation et espace commercial."
    };
  });

  return rows.sort((a, b) => b.intelligence_score - a.intelligence_score);
}