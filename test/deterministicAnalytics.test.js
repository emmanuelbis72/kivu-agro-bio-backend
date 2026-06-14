import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCollectionPriority,
  resolveAnalysisPeriod,
  weightedMovingAverage
} from "../services/analytics/deterministicAnalytics.service.js";
import { detectIntent } from "../services/ai/naturalQuery.service.js";

test("resolveAnalysisPeriod returns exact monthly boundaries", () => {
  const result = resolveAnalysisPeriod(
    "this_month",
    new Date("2026-06-12T10:00:00.000Z")
  );

  assert.deepEqual(result, {
    key: "this_month",
    start_date: "2026-06-01",
    end_date: "2026-06-12",
    previous_start_date: "2026-05-01",
    previous_end_date: "2026-05-31"
  });
});

test("weightedMovingAverage gives more weight to recent months", () => {
  assert.equal(weightedMovingAverage([100, 200, 300]), 233.33);
  assert.equal(weightedMovingAverage([]), 0);
});

test("collection priority becomes critical for large and old receivables", () => {
  const result = calculateCollectionPriority({
    balance_due: 2500,
    days_overdue: 60,
    historical_late_rate: 0.8,
    payment_ratio: 0.25,
    strategic_weight: 5
  });

  assert.equal(result.priority, "critical");
  assert.ok(result.score >= 80);
  assert.ok(result.payment_likelihood_score <= 20);
  assert.equal(result.owner_role, "Finance / Recouvrement");
  assert.equal(result.deadline_days, 0);
  assert.match(result.credit_decision, /Suspendre/);
  assert.equal(result.score_breakdown.lateness, 30);
});

test("collection priority remains monitored for a small current balance", () => {
  const result = calculateCollectionPriority({
    balance_due: 50,
    days_overdue: 0,
    historical_late_rate: 0,
    payment_ratio: 1
  });

  assert.equal(result.priority, "monitor");
  assert.ok(result.score < 40);
});

test("natural language routes profitability and collection questions", () => {
  assert.equal(
    detectIntent("Quels produits sont les plus rentables ce mois-ci ?").intent,
    "profitability_analysis"
  );
  assert.equal(
    detectIntent("Quelles creances dois-je recouvrer aujourd'hui ?").intent,
    "customer_receivables_risk"
  );
});
