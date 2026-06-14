import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPracticalActionPlan,
  createPracticalAction,
  formatPracticalAction
} from "../utils/practicalAI.util.js";

const referenceDate = new Date("2026-06-14T08:00:00.000Z");

test("practical action keeps high priority and assigns a concrete deadline", () => {
  const action = createPracticalAction(
    {
      id: "collect-1",
      domain: "receivables",
      priority: "high",
      title: "Recouvrer le client",
      action: "Obtenir un engagement de paiement.",
      owner_role: "Recouvrement",
      deadline_days: 2,
      target_amount: 1200,
      first_step: "Appeler le client.",
      success_metric: "Engagement date confirme."
    },
    referenceDate
  );

  assert.equal(action.priority, "high");
  assert.equal(action.deadline, "2026-06-16");
  assert.equal(action.owner_role, "Recouvrement");
  assert.equal(action.target_amount, 1200);
  assert.equal(action.success_metric, "Engagement date confirme.");
});

test("stock action formats its target as units instead of dollars", () => {
  const action = createPracticalAction(
    {
      domain: "stock",
      priority: "critical",
      title: "Reapprovisionner",
      action: "Commander le produit.",
      target_amount: 25
    },
    referenceDate
  );

  assert.match(formatPracticalAction(action), /Objectif: 25 unites/);
  assert.doesNotMatch(formatPracticalAction(action), /25 USD/);
});

test("action plan sorts critical work before lower priorities", () => {
  const plan = buildPracticalActionPlan(
    [
      { title: "Suivi", action: "Controler.", priority: "medium" },
      { title: "Urgent", action: "Agir.", priority: "critical" },
      { title: "Important", action: "Traiter.", priority: "high" }
    ],
    referenceDate
  );

  assert.deepEqual(
    plan.map((item) => item.priority),
    ["critical", "high", "medium"]
  );
});
