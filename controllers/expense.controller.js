import {
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense
} from "../models/expense.model.js";
import {
  getSupplierByBusinessName,
  getSupplierById
} from "../models/supplier.model.js";
import { autoPostExpenseEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";
import { safeRecordAuditEvent } from "../services/audit.service.js";

const ALLOWED_EXPENSE_PAYMENT_METHODS = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "card"
];

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
    errors.push("Le champ 'amount' doit etre un nombre superieur a 0.");
  }

  if (
    body.payment_method !== undefined &&
    body.payment_method !== null &&
    body.payment_method !== "" &&
    !ALLOWED_EXPENSE_PAYMENT_METHODS.includes(String(body.payment_method).trim())
  ) {
    errors.push(
      "Le champ 'payment_method' est invalide. Valeurs attendues : cash, mobile_money, bank_transfer, card."
    );
  }

  if (
    body.supplier_id !== undefined &&
    body.supplier_id !== null &&
    body.supplier_id !== "" &&
    (!Number.isInteger(Number(body.supplier_id)) || Number(body.supplier_id) <= 0)
  ) {
    errors.push("Le champ 'supplier_id' doit etre un entier positif ou nul.");
  }

  return errors;
}

async function normalizeExpenseSupplierPayload(body) {
  const category = String(body.category || "").trim().toLowerCase();
  const isTanzaniaFreight =
    ["transport", "fret"].includes(category) &&
    String(body.supplier || "").trim().toLowerCase() === "tanzanie";
  const supplierId =
    body.supplier_id === undefined ||
    body.supplier_id === null ||
    body.supplier_id === ""
      ? null
      : Number(body.supplier_id);

  if (!supplierId && isTanzaniaFreight) {
    const ratco = await getSupplierByBusinessName("RATCO");

    if (!ratco) {
      const error = new Error(
        "Le fournisseur RATCO doit etre cree avant d'enregistrer ce transport."
      );
      error.statusCode = 400;
      throw error;
    }

    return {
      supplier_id: ratco.id,
      supplier: ratco.business_name
    };
  }

  if (!supplierId) {
    return {
      supplier_id: null,
      supplier: body.supplier?.trim() || null
    };
  }

  const supplier = await getSupplierById(supplierId);

  if (!supplier) {
    const error = new Error("Fournisseur introuvable.");
    error.statusCode = 400;
    throw error;
  }

  if (
    ["transport", "fret"].includes(category) &&
    String(supplier.business_name || "").trim().toLowerCase() === "tanzanie"
  ) {
    const ratco = await getSupplierByBusinessName("RATCO");

    if (!ratco) {
      const error = new Error(
        "Le fournisseur RATCO doit etre cree avant d'enregistrer ce transport."
      );
      error.statusCode = 400;
      throw error;
    }

    return {
      supplier_id: ratco.id,
      supplier: ratco.business_name
    };
  }

  return {
    supplier_id: supplier.id,
    supplier: supplier.business_name
  };
}

export async function createExpenseHandler(req, res, next) {
  try {
    const errors = validateExpensePayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const supplierPayload = await normalizeExpenseSupplierPayload(req.body);

    const expense = await createExpense({
      expense_date: req.body.expense_date,
      category: req.body.category.trim(),
      description: req.body.description.trim(),
      amount: Number(req.body.amount),
      payment_method: req.body.payment_method?.trim() || "cash",
      supplier_id: supplierPayload.supplier_id,
      supplier: supplierPayload.supplier,
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim(),
      created_by: req.user?.id || null
    });

    let accounting = {
      status: "skipped",
      reason: "Aucune tentative de comptabilisation."
    };

    try {
      accounting = await autoPostExpenseEntry({
        expense,
        accounting: req.body.accounting || {},
        created_by: req.user?.id || null
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

    await safeRecordAuditEvent({
      req,
      module: "expenses",
      action_type: "create",
      entity_type: "expense",
      entity_id: expense.id,
      document_reference: expense.reference,
      new_value: expense,
      reason: req.body.reason || "Creation d'une depense",
      risk_level: "high",
      metadata: { accounting_status: accounting.status }
    });

    return res.status(201).json({
      success: true,
      message: "Depense creee avec succes.",
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
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }

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
        message: "ID depense invalide."
      });
    }

    const expense = await getExpenseById(id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Depense introuvable."
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
        message: "ID depense invalide."
      });
    }

    const existingExpense = await getExpenseById(id);

    if (!existingExpense) {
      return res.status(404).json({
        success: false,
        message: "Depense introuvable."
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
        message: "Validation echouee.",
        errors
      });
    }

    const supplierPayload = await normalizeExpenseSupplierPayload(mergedPayload);

    const updatedExpense = await updateExpense(id, {
      expense_date: mergedPayload.expense_date,
      category: String(mergedPayload.category).trim(),
      description: String(mergedPayload.description).trim(),
      amount: Number(mergedPayload.amount),
      payment_method: mergedPayload.payment_method?.trim() || "cash",
      supplier_id: supplierPayload.supplier_id,
      supplier: supplierPayload.supplier,
      reference: mergedPayload.reference?.trim(),
      notes: mergedPayload.notes?.trim()
    });

    await safeRecordAuditEvent({
      req,
      module: "expenses",
      action_type: "update",
      entity_type: "expense",
      entity_id: id,
      document_reference: updatedExpense.reference,
      old_value: existingExpense,
      new_value: updatedExpense,
      reason: req.body.reason || "Modification d'une depense",
      risk_level: "high"
    });

    return res.status(200).json({
      success: true,
      message: "Depense mise a jour avec succes.",
      data: updatedExpense
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }

    next(error);
  }
}

export async function deleteExpenseHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID depense invalide."
      });
    }

    const existingExpense = await getExpenseById(id);
    const deletedExpense = await deleteExpense(id, {
      archived_by: req.user?.id || null,
      reason: req.body?.reason || "Archivage d'une depense"
    });

    if (!deletedExpense) {
      return res.status(404).json({
        success: false,
        message: "Depense introuvable."
      });
    }

    await safeRecordAuditEvent({
      req,
      module: "expenses",
      action_type: "archive",
      entity_type: "expense",
      entity_id: id,
      document_reference: deletedExpense.reference,
      old_value: existingExpense,
      new_value: deletedExpense,
      reason: req.body?.reason || "Archivage d'une depense",
      risk_level: "high"
    });

    return res.status(200).json({
      success: true,
      message: "Depense archivee avec succes.",
      data: deletedExpense
    });
  } catch (error) {
    next(error);
  }
}
