import { getBusinessRulesMap } from "./businessRules.service.js";
import { getProductScores } from "./productScoring.service.js";
import { getCustomerScores } from "./customerScoring.service.js";
import { getCashScore } from "./cashScoring.service.js";

export async function getAIScoringSummary() {
  const businessRules = await getBusinessRulesMap();

  const [products, customers, cash] = await Promise.all([
    getProductScores(businessRules),
    getCustomerScores(businessRules),
    getCashScore(businessRules)
  ]);

  return {
    top_priority_products: products.slice(0, 10),
    top_risky_customers: customers.slice(0, 10),
    cash,
    generated_at: new Date().toISOString()
  };
}