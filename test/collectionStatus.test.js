import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveCollectionAlert,
  resolveCollectionPaymentStatus
} from "../utils/collectionStatus.util.js";

test("collection payment status distinguishes paid, partial and unpaid invoices", () => {
  assert.equal(
    resolveCollectionPaymentStatus({ paid_amount: 0, balance_due: 100 }),
    "unpaid"
  );
  assert.equal(
    resolveCollectionPaymentStatus({ paid_amount: 25, balance_due: 75 }),
    "partial"
  );
  assert.equal(
    resolveCollectionPaymentStatus({ paid_amount: 100, balance_due: 0 }),
    "paid"
  );
});

test("collection alerts follow the configured age boundaries", () => {
  assert.equal(resolveCollectionAlert(21).level, "green");
  assert.equal(resolveCollectionAlert(22).level, "light_green");
  assert.equal(resolveCollectionAlert(29).level, "light_green");
  assert.equal(resolveCollectionAlert(30).level, "orange");
  assert.equal(resolveCollectionAlert(44).level, "orange");
  assert.equal(resolveCollectionAlert(45).level, "red");
  assert.equal(resolveCollectionAlert(90, "paid").level, "paid");
});
