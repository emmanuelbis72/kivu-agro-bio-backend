import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTheoreticalStockPosition,
  convertStockQuantity,
  convertToReportingQuantity,
  getStockUnitFamily,
  normalizeStockUnit
} from "../utils/stockUnit.util.js";

test("stock units convert grams to kilograms", () => {
  assert.equal(convertStockQuantity(1500, "g", "kg"), 1.5);
  assert.deepEqual(convertToReportingQuantity(250, "g"), {
    quantity: 0.25,
    unit: "kg"
  });
});

test("stock units convert milliliters to liters", () => {
  assert.equal(convertStockQuantity(1250, "ml", "l"), 1.25);
});

test("stock units reject incompatible families", () => {
  assert.throws(
    () => convertStockQuantity(1, "kg", "l"),
    /Conversion impossible/
  );
});

test("piece is normalized as a count unit", () => {
  assert.equal(normalizeStockUnit("piece"), "unit");
  assert.equal(getStockUnitFamily("piece"), "count");
});

test("theoretical stock reports a shortage without blocking consumption", () => {
  const position = calculateTheoreticalStockPosition({
    currentStock: -2,
    bulkEntries: 10,
    invoiceConsumption: 12
  });

  assert.equal(position.openingStock, 0);
  assert.equal(position.totalConsumption, 12);
  assert.equal(position.netFlow, -2);
  assert.equal(position.theoreticalRemaining, -2);
  assert.equal(position.shortageQuantity, 2);
});
