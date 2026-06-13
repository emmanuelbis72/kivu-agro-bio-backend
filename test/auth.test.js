import test from "node:test";
import assert from "node:assert/strict";
import {
  hasAnyRole,
  normalizeRole,
  resolveAuthEnforcementMode
} from "../middlewares/auth.middleware.js";

test("roles are normalized before authorization", () => {
  assert.equal(normalizeRole(" Director_General "), "director_general");
  assert.equal(
    hasAnyRole({ role: "ACCOUNTANT" }, ["director_general", "accountant"]),
    true
  );
});

test("unknown role is denied", () => {
  assert.equal(hasAnyRole({ role: "staff" }, ["admin"]), false);
});

test("authentication enforcement stays transitional unless strict is explicit", () => {
  assert.equal(resolveAuthEnforcementMode(), "transition");
  assert.equal(resolveAuthEnforcementMode("transition"), "transition");
  assert.equal(resolveAuthEnforcementMode("invalid"), "transition");
  assert.equal(resolveAuthEnforcementMode(" STRICT "), "strict");
});
