import {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense
} from "../models/expense.model.js";
import { autoPostExpenseEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function validateExpensePayload(body) {
  const errors = [];

  if (!body.expense_date || String(body.expense_date).trim() === "") {
    errors.push("Le champ 'expense_date' est obligatoire.");
  }

  if (!body.category || String(body.category).trim() === "") {
    errors.push("Le champ 'category' est obligatoire.");
  }

  if (!body.description || String(body.description).trim() === "") {
    errors.push("Le champ 'description' est obligatoire.");
  }

  if (
    body.amount === undefined ||
    body.amount === null ||
    Number.isNaN(Number(body.amount)) ||
    Number(body.amount) <= 0
  ) {
    errors.push("Le champ 'amount' doit être un nombre supérieur à 0.");
  }

  return errors;
}

export async function createExpenseHandler(req, res, next) {
  try {
    const errors = validateExpensePayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const expense = await createExpense({
      expense_date: req.body.expense_date,
      category: req.body.category.trim(),
      description: req.body.description.trim(),
      amount: Number(req.body.amount),
      payment_method: req.body.payment_method?.trim() || "cash",
      supplier: req.body.supplier?.trim(),
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim()
    });

    let accounting = {
      status: "skipped",
      reason: "Aucune tentative de comptabilisation."
    };

    try {
      accounting = await autoPostExpenseEntry({
        expense,
        accounting: req.body.accounting || {},
        created_by: req.body.created_by ? Number(req.body.created_by) : null
      });
    } catch (accountingError) {
      accounting = {
        status: "error",
        reason: accountingError.message
      };
    }

    await persistAccountingStatus({
      tableName: "expenses",
      recordId: expense.id,
      accountingResult: accounting
    });

    return res.status(201).json({
      success: true,
      message: "Dépense créée avec succès.",
      data: {
        expense: {
          ...expense,
          accounting_status: accounting.status || null,
          accounting_entry_id: accounting.journal_entry_id || null,
          accounting_message: accounting.reason || null
        },
        accounting
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllExpensesHandler(req, res, next) {
  try {
    const expenses = await getAllExpenses();

    return res.status(200).json({
      success: true,
      count: expenses.length,
      data: expenses
    });
  } catch (error) {
    next(error);
  }
}

export async function getExpenseByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépense invalide."
      });
    }

    const expense = await getExpenseById(id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Dépense introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: expense
    });
  } catch (error) {
    next(error);
  }
}

export async function updateExpenseHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépense invalide."
      });
    }

    const existingExpense = await getExpenseById(id);

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        message: "Dépense introuvable."
      });
    }

    const mergedPayload = {
      ...existingExpense,
      ...req.body
    };

    const errors = validateExpensePayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const updatedExpense = await updateExpense(id, {
      expense_date: mergedPayload.expense_date,
      category: String(mergedPayload.category).trim(),
      description: String(mergedPayload.description).trim(),
      amount: Number(mergedPayload.amount),
      payment_method: mergedPayload.payment_method?.trim() || "cash",
      supplier: mergedPayload.supplier?.trim(),
      reference: mergedPayload.reference?.trim(),
      notes: mergedPayload.notes?.trim()
    });

    return res.status(200).json({
      success: true,
      message: "Dépense mise à jour avec succès.",
      data: updatedExpense
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteExpenseHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépense invalide."
      });
    }

    const deletedExpense = await deleteExpense(id);

    if (!deletedExpense) {
      return res.status(404).json({
        success: false,
        message: "Dépense introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Dépense supprimée avec succès.",
      data: deletedExpense
    });
  } catch (error) {
    next(error);
  }
}