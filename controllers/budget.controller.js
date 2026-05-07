import {
  BUDGET_CATEGORY_DEFINITIONS,
  createBudgetWithLines,
  deleteBudgetById,
  getAllBudgets,
  getBudgetById,
  getBudgetVsActual,
  updateBudgetWithLines
} from "../models/budget.model.js";
import {
  buildExportFilename,
  createBudgetVsActualPdfBuffer,
  createBudgetVsActualXlsxBuffer,
  sendDownloadBuffer
} from "../services/reportExport.service.js";

const budgetCategoryKeys = new Set(
  BUDGET_CATEGORY_DEFINITIONS.map((item) => item.key)
);

function validateBudgetPayload(body) {
  const errors = [];

  if (!body.name || String(body.name).trim() === "") {
    errors.push("Le champ 'name' est obligatoire.");
  }

  const fiscalYear = Number(body.fiscal_year);
  if (
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 2000 ||
    fiscalYear > 2100
  ) {
    errors.push("Le champ 'fiscal_year' doit etre une annee valide.");
  }

  if (
    body.warehouse_id !== undefined &&
    body.warehouse_id !== null &&
    body.warehouse_id !== "" &&
    (!Number.isInteger(Number(body.warehouse_id)) ||
      Number(body.warehouse_id) <= 0)
  ) {
    errors.push("Le champ 'warehouse_id' doit etre un entier positif ou nul.");
  }

  if (
    body.lines !== undefined &&
    body.lines !== null &&
    !Array.isArray(body.lines)
  ) {
    errors.push("Le champ 'lines' doit etre un tableau.");
  }

  const seenKeys = new Set();

  if (Array.isArray(body.lines)) {
    body.lines.forEach((line, index) => {
      const categoryKey = String(line?.category_key || "").trim();
      const monthNumber = Number(line?.month_number);
      const plannedAmount = Number(line?.planned_amount ?? 0);

      if (!budgetCategoryKeys.has(categoryKey)) {
        errors.push(
          `Ligne ${index + 1}: categorie invalide '${categoryKey || "-"}'.`
        );
      }

      if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
        errors.push(`Ligne ${index + 1}: 'month_number' doit etre entre 1 et 12.`);
      }

      if (Number.isNaN(plannedAmount) || plannedAmount < 0) {
        errors.push(
          `Ligne ${index + 1}: 'planned_amount' doit etre un nombre >= 0.`
        );
      }

      const dedupeKey = `${categoryKey}::${monthNumber}`;
      if (seenKeys.has(dedupeKey)) {
        errors.push(
          `Ligne ${index + 1}: doublon detecte pour ${categoryKey} mois ${monthNumber}.`
        );
      }
      seenKeys.add(dedupeKey);
    });
  }

  return errors;
}

function normalizeLines(lines = []) {
  const lineMap = new Map();

  lines.forEach((line) => {
    const key = `${String(line.category_key).trim()}::${Number(line.month_number)}`;
    lineMap.set(key, Number(line.planned_amount || 0));
  });

  return BUDGET_CATEGORY_DEFINITIONS.flatMap((category) =>
    Array.from({ length: 12 }, (_, monthIndex) => {
      const monthNumber = monthIndex + 1;
      const key = `${category.key}::${monthNumber}`;

      return {
        category_key: category.key,
        month_number: monthNumber,
        planned_amount: Number(lineMap.get(key) || 0)
      };
    })
  );
}

function normalizeBudgetPayload(body) {
  return {
    name: String(body.name).trim(),
    fiscal_year: Number(body.fiscal_year),
    warehouse_id:
      body.warehouse_id === undefined ||
      body.warehouse_id === null ||
      body.warehouse_id === ""
        ? null
        : Number(body.warehouse_id),
    notes: body.notes?.trim() || null,
    is_active:
      body.is_active === undefined ? true : Boolean(body.is_active),
    lines: normalizeLines(Array.isArray(body.lines) ? body.lines : [])
  };
}

function parseBudgetId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function getBudgetCategoriesHandler(req, res) {
  return res.status(200).json({
    success: true,
    data: BUDGET_CATEGORY_DEFINITIONS
  });
}

export async function createBudgetHandler(req, res, next) {
  try {
    const errors = validateBudgetPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const budget = await createBudgetWithLines(normalizeBudgetPayload(req.body));

    return res.status(201).json({
      success: true,
      message: "Budget cree avec succes.",
      data: budget
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllBudgetsHandler(req, res, next) {
  try {
    const budgets = await getAllBudgets();

    return res.status(200).json({
      success: true,
      count: budgets.length,
      data: budgets
    });
  } catch (error) {
    next(error);
  }
}

export async function getBudgetByIdHandler(req, res, next) {
  try {
    const id = parseBudgetId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID budget invalide."
      });
    }

    const budget = await getBudgetById(id);

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: budget
    });
  } catch (error) {
    next(error);
  }
}

export async function getBudgetVsActualHandler(req, res, next) {
  try {
    const id = parseBudgetId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID budget invalide."
      });
    }

    const comparison = await getBudgetVsActual(id);

    if (!comparison) {
      return res.status(404).json({
        success: false,
        message: "Budget introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: comparison
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBudgetHandler(req, res, next) {
  try {
    const id = parseBudgetId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID budget invalide."
      });
    }

    const existingBudget = await getBudgetById(id);

    if (!existingBudget) {
      return res.status(404).json({
        success: false,
        message: "Budget introuvable."
      });
    }

    const mergedPayload = {
      ...existingBudget,
      ...req.body,
      lines: req.body.lines ?? existingBudget.lines
    };

    const errors = validateBudgetPayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const budget = await updateBudgetWithLines(
      id,
      normalizeBudgetPayload(mergedPayload)
    );

    return res.status(200).json({
      success: true,
      message: "Budget mis a jour avec succes.",
      data: budget
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteBudgetHandler(req, res, next) {
  try {
    const id = parseBudgetId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID budget invalide."
      });
    }

    const deletedBudget = await deleteBudgetById(id);

    if (!deletedBudget) {
      return res.status(404).json({
        success: false,
        message: "Budget introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Budget supprime avec succes."
    });
  } catch (error) {
    next(error);
  }
}

export async function exportBudgetVsActualHandler(req, res, next) {
  try {
    const id = parseBudgetId(req.params.id);
    const format = String(req.params.format || "").trim().toLowerCase();

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "ID budget invalide."
      });
    }

    if (!["pdf", "xlsx"].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Format d'export invalide."
      });
    }

    const comparison = await getBudgetVsActual(id);

    if (!comparison) {
      return res.status(404).json({
        success: false,
        message: "Budget introuvable."
      });
    }

    const filename = buildExportFilename(
      `budget-vs-reel-${comparison.budget?.name || id}-${comparison.budget?.fiscal_year || ""}`,
      format
    );

    if (format === "pdf") {
      const buffer = await createBudgetVsActualPdfBuffer(comparison);
      return sendDownloadBuffer(res, buffer, filename, "application/pdf");
    }

    const buffer = await createBudgetVsActualXlsxBuffer(comparison);
    return sendDownloadBuffer(
      res,
      buffer,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  } catch (error) {
    next(error);
  }
}
