import { getTopCustomers } from "../../models/dashboard.model.js";

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function isPriorityCity(cityName, businessRules = {}) {
  const priorityCities = Array.isArray(businessRules?.priority_cities)
    ? businessRules.priority_cities
    : [];

  return priorityCities.some((item) => normalize(item) === normalize(cityName));
}

function isPriorityChannel(customerName, businessRules = {}) {
  const priorityChannels = Array.isArray(businessRules?.priority_channels)
    ? businessRules.priority_channels
    : [];

  const normalizedCustomer = normalize(customerName);

  return priorityChannels.some((item) =>
    normalizedCustomer.includes(normalize(item))
  );
}

export async function getCustomerScores(businessRules = {}) {
  const customers = await getTopCustomers(30);

  const scoredCustomers = customers.map((customer) => {
    const receivable = Number(customer.total_balance_due || 0);
    const sales = Number(customer.total_sales_amount || 0);
    const cityPriority = isPriorityCity(customer.city, businessRules);
    const channelPriority = isPriorityChannel(
      customer.business_name,
      businessRules
    );

    let riskScore = 0;
    let valueScore = 0;

    riskScore += Math.min(Math.floor(receivable / 100), 40);
    if (cityPriority) riskScore += 10;
    if (channelPriority) riskScore += 15;

    valueScore += Math.min(Math.floor(sales / 100), 40);
    if (cityPriority) valueScore += 10;
    if (channelPriority) valueScore += 20;

    let status = "normal";

    if (receivable > 0 && (cityPriority || channelPriority)) {
      status = "watchlist";
    }

    if (receivable >= 500 && (cityPriority || channelPriority)) {
      status = "critical";
    }

    return {
      customer_id: customer.id,
      business_name: customer.business_name,
      city: customer.city || null,
      total_sales_amount: round2(sales),
      total_balance_due: round2(receivable),
      is_priority_city: cityPriority,
      is_priority_channel: channelPriority,
      customer_risk_score: riskScore,
      customer_value_score: valueScore,
      status
    };
  });

  return scoredCustomers.sort(
    (a, b) => Number(b.customer_risk_score) - Number(a.customer_risk_score)
  );
}