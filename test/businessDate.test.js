import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBusinessDate } from "../utils/businessDate.util.js";

test("business dates reject malformed and implausible invoice years", () => {
  assert.match(
    normalizeBusinessDate("0226-06-12", "invoice_date", {
      required: true
    }).error,
    /2000 et 2100/
  );
  assert.match(
    normalizeBusinessDate("2026-02-31", "invoice_date", {
      required: true
    }).error,
    /date invalide/
  );
});

test("business dates accept a valid 2026 invoice date", () => {
  assert.deepEqual(
    normalizeBusinessDate("2026-06-12", "invoice_date", {
      required: true
    }),
    { value: "2026-06-12" }
  );
});
