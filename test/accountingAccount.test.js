import test from "node:test";
import assert from "node:assert/strict";
import { isIncomeAccount } from "../utils/accountingAccount.util.js";

test("income account validation rejects a customer receivable account", () => {
  assert.equal(
    isIncomeAccount({
      account_class: "4",
      account_type: "asset",
      is_active: true,
      is_postable: true
    }),
    false
  );
});

test("income account validation accepts an active class 7 account", () => {
  assert.equal(
    isIncomeAccount({
      account_class: "7",
      account_type: "income",
      is_active: true,
      is_postable: true
    }),
    true
  );
});
