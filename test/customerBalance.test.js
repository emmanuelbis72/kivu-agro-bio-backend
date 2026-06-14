import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCustomerBalanceRow } from "../utils/customerBalance.util.js";

test("customer balance uses invoice balance due instead of period cash flow", () => {
  const row = normalizeCustomerBalanceRow({
    invoiced_amount: 44308.86,
    paid_amount: 35429.36,
    balance_due_amount: 4073.6,
    balance_amount: 8879.5
  });

  assert.equal(row.balance_due_amount, 4073.6);
  assert.equal(row.balance_amount, 4073.6);
});

test("customer balance falls back to invoiced minus paid when no balance is supplied", () => {
  const row = normalizeCustomerBalanceRow({
    invoiced_amount: 1000,
    paid_amount: 250
  });

  assert.equal(row.balance_amount, 750);
});
