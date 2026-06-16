const UNIT_DEFINITIONS = {
  g: { family: "mass", factor: 0.001, reportingUnit: "kg" },
  kg: { family: "mass", factor: 1, reportingUnit: "kg" },
  ml: { family: "volume", factor: 0.001, reportingUnit: "l" },
  l: { family: "volume", factor: 1, reportingUnit: "l" },
  unit: { family: "count", factor: 1, reportingUnit: "unit" },
  piece: { family: "count", factor: 1, reportingUnit: "unit" }
};

export const STOCK_UNITS = Object.freeze(Object.keys(UNIT_DEFINITIONS));

export function normalizeStockUnit(value, fallback = "unit") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (UNIT_DEFINITIONS[normalized]) {
    return normalized === "piece" ? "unit" : normalized;
  }

  return fallback;
}

export function getStockUnitFamily(unit) {
  const normalized = normalizeStockUnit(unit, null);
  return normalized ? UNIT_DEFINITIONS[normalized].family : null;
}

export function getReportingStockUnit(unit) {
  const normalized = normalizeStockUnit(unit, null);
  return normalized ? UNIT_DEFINITIONS[normalized].reportingUnit : null;
}

export function convertStockQuantity(quantity, fromUnit, toUnit) {
  const numericQuantity = Number(quantity);
  const normalizedFrom = normalizeStockUnit(fromUnit, null);
  const normalizedTo = normalizeStockUnit(toUnit, null);

  if (!Number.isFinite(numericQuantity)) {
    throw new Error("La quantite a convertir est invalide.");
  }

  if (!normalizedFrom || !normalizedTo) {
    throw new Error("L'unite de stock est invalide.");
  }

  const fromDefinition = UNIT_DEFINITIONS[normalizedFrom];
  const toDefinition = UNIT_DEFINITIONS[normalizedTo];

  if (fromDefinition.family !== toDefinition.family) {
    throw new Error(
      `Conversion impossible de ${normalizedFrom} vers ${normalizedTo}.`
    );
  }

  return numericQuantity * fromDefinition.factor / toDefinition.factor;
}

export function convertToReportingQuantity(quantity, unit) {
  const reportingUnit = getReportingStockUnit(unit);

  if (!reportingUnit) {
    throw new Error("L'unite de stock est invalide.");
  }

  return {
    quantity: convertStockQuantity(quantity, unit, reportingUnit),
    unit: reportingUnit
  };
}

export function calculateTheoreticalStockPosition({
  currentStock = 0,
  bulkEntries = 0,
  transferIn = 0,
  transferOut = 0,
  invoiceConsumption = 0,
  productionConsumption = 0,
  otherConsumption = 0,
  invoiceReversals = 0
} = {}) {
  const totalConsumption =
    Number(invoiceConsumption || 0) +
    Number(productionConsumption || 0) +
    Number(otherConsumption || 0);
  const netFlow =
    Number(bulkEntries || 0) +
    Number(transferIn || 0) +
    Number(invoiceReversals || 0) -
    Number(transferOut || 0) -
    totalConsumption;
  const theoreticalRemaining = Number(currentStock || 0);

  return {
    totalConsumption,
    netFlow,
    openingStock: theoreticalRemaining - netFlow,
    theoreticalRemaining,
    shortageQuantity: Math.max(0, -theoreticalRemaining)
  };
}
