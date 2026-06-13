import {
  createPurchaseInvoiceWithItems,
  createSupplierPayment,
  getAllPurchaseInvoices,
  getNextPurchaseInvoiceNumberForDate,
  getPurchaseInvoiceById,
  getSupplierPaymentById,
  updatePurchaseInvoiceWithItems,
  deletePurchaseInvoiceById
} from "../models/purchaseInvoice.model.js";
import {
  autoPostPurchaseInvoiceEntry,
  autoPostSupplierPaymentEntry
} from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";
import { normalizeBusinessDate } from "../utils/businessDate.util.js";

const ALLOWED_PAYMENT_METHODS = [
  "cash",
  "mobile_money",
  "bank_transfer",
  "card"
];

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) > 0;
}

function validatePurchaseInvoicePayload(body) {
  const errors = [];

  if (!isPositiveInteger(body.supplier_id)) {
    errors.push("Le champ 'supplier_id' est obligatoire.");
  }

  if (!isPositiveInteger(body.warehouse_id)) {
    errors.push("Le champ 'warehouse_id' est obligatoire.");
  }

  if (!body.invoice_date || String(body.invoice_date).trim() === "") {
    errors.push("Le champ 'invoice_date' est obligatoire.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("Ajoute au moins une ligne d'achat.");
  }

  for (const item of body.items || []) {
    if (!isPositiveInteger(item.product_id)) {
      errors.push("Chaque ligne doit avoir un produit valide.");
      break;
    }

    if (!isPositiveNumber(item.quantity)) {
      errors.push("Chaque ligne doit avoir une quantite positive.");
      break;
    }

    if (Number.isNaN(Number(item.unit_cost)) || Number(item.unit_cost) < 0) {
      errors.push("Chaque ligne doit avoir un cout unitaire valide.");
      break;
    }
  }

  return errors;
}

function normalizePurchaseInvoiceDates(body) {
  const invoiceDate = normalizeBusinessDate(
    body.invoice_date,
    "invoice_date",
    { required: true }
  );

  if (invoiceDate.error) {
    return { error: invoiceDate.error };
  }

  const dueDate = normalizeBusinessDate(body.due_date, "due_date");

  if (dueDate.error) {
    return { error: dueDate.error };
  }

  return {
    invoice_date: invoiceDate.value,
    due_date: dueDate.value
  };
}

async function ensurePurchaseInvoiceAccounting(purchaseInvoice, accounting = {}, created_by = null) {
  let accountingResult = {
    status: "skipped",
    reason: "Aucune tentative de comptabilisation."
  };

  try {
    accountingResult = await autoPostPurchaseInvoiceEntry({
      purchaseInvoice,
      accounting,
      created_by
    });
  } catch (accountingError) {
    accountingResult = {
      status: "error",
      reason: accountingError.message
    };
  }

  await persistAccountingStatus({
    tableName: "purchase_invoices",
    recordId: purchaseInvoice.id,
    accountingResult
  });

  return accountingResult;
}

async function ensureSupplierPaymentAccounting(
  supplierPayment,
  purchaseInvoice,
  accounting = {},
  created_by = null
) {
  let accountingResult = {
    status: "skipped",
    reason: "Aucune tentative de comptabilisation."
  };

  try {
    accountingResult = await autoPostSupplierPaymentEntry({
      supplierPayment,
      purchaseInvoice,
      accounting,
      created_by
    });
  } catch (accountingError) {
    accountingResult = {
      status: "error",
      reason: accountingError.message
    };
  }

  await persistAccountingStatus({
    tableName: "supplier_payments",
    recordId: supplierPayment.id,
    accountingResult
  });

  return accountingResult;
}

export async function createPurchaseInvoiceHandler(req, res, next) {
  try {
    const errors = validatePurchaseInvoicePayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const normalizedDates = normalizePurchaseInvoiceDates(req.body);

    if (normalizedDates.error) {
      return res.status(400).json({
        success: false,
        message: normalizedDates.error
      });
    }

    const normalizedItems = req.body.items.map((item) => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.quantity) * Number(item.unit_cost)
    }));

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0
    );
    const taxAmount = Number(req.body.tax_amount || 0);
    const totalAmount = subtotal + taxAmount;
    const purchaseInvoiceNumber =
      req.body.purchase_invoice_number?.trim() ||
      (await getNextPurchaseInvoiceNumberForDate(normalizedDates.invoice_date));

    const purchaseInvoice = await createPurchaseInvoiceWithItems({
      purchase_invoice_number: purchaseInvoiceNumber,
      supplier_id: Number(req.body.supplier_id),
      warehouse_id: Number(req.body.warehouse_id),
      invoice_date: normalizedDates.invoice_date,
      due_date: normalizedDates.due_date,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    const accounting = await ensurePurchaseInvoiceAccounting(
      purchaseInvoice,
      req.body.accounting || {},
      req.body.created_by ? Number(req.body.created_by) : null
    );

    const refreshedPurchaseInvoice = await getPurchaseInvoiceById(purchaseInvoice.id);

    return res.status(201).json({
      success: true,
      message: "Facture fournisseur creee avec succes.",
      data: {
        purchase_invoice: {
          ...refreshedPurchaseInvoice,
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

export async function getAllPurchaseInvoicesHandler(req, res, next) {
  try {
    const purchaseInvoices = await getAllPurchaseInvoices();

    return res.status(200).json({
      success: true,
      count: purchaseInvoices.length,
      data: purchaseInvoices
    });
  } catch (error) {
    next(error);
  }
}

export async function getPurchaseInvoiceByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture fournisseur invalide."
      });
    }

    const purchaseInvoice = await getPurchaseInvoiceById(id);

    if (!purchaseInvoice) {
      return res.status(404).json({
        success: false,
        message: "Facture fournisseur introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: purchaseInvoice
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePurchaseInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture fournisseur invalide."
      });
    }

    const errors = validatePurchaseInvoicePayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const normalizedDates = normalizePurchaseInvoiceDates(req.body);

    if (normalizedDates.error) {
      return res.status(400).json({
        success: false,
        message: normalizedDates.error
      });
    }

    const normalizedItems = req.body.items.map((item) => ({
      product_id: Number(item.product_id),
      quantity: Number(item.quantity),
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.quantity) * Number(item.unit_cost)
    }));

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0
    );
    const taxAmount = Number(req.body.tax_amount || 0);
    const totalAmount = subtotal + taxAmount;

    const purchaseInvoice = await updatePurchaseInvoiceWithItems(id, {
      supplier_id: Number(req.body.supplier_id),
      warehouse_id: Number(req.body.warehouse_id),
      invoice_date: normalizedDates.invoice_date,
      due_date: normalizedDates.due_date,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    const accounting = await ensurePurchaseInvoiceAccounting(
      purchaseInvoice,
      req.body.accounting || {},
      req.body.created_by ? Number(req.body.created_by) : null
    );

    const refreshedPurchaseInvoice = await getPurchaseInvoiceById(id);

    return res.status(200).json({
      success: true,
      message: "Facture fournisseur mise a jour avec succes.",
      data: {
        purchase_invoice: {
          ...refreshedPurchaseInvoice,
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

export async function deletePurchaseInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture fournisseur invalide."
      });
    }

    const deletedPurchaseInvoice = await deletePurchaseInvoiceById(id);

    if (!deletedPurchaseInvoice) {
      return res.status(404).json({
        success: false,
        message: "Facture fournisseur introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Facture fournisseur supprimee avec succes.",
      data: deletedPurchaseInvoice
    });
  } catch (error) {
    next(error);
  }
}

export async function createSupplierPaymentHandler(req, res, next) {
  try {
    const purchaseInvoiceId = Number(req.params.id);
    const amount = Number(req.body.amount);
    const paymentMethod = String(req.body.payment_method || "cash").trim();
    const paymentDate =
      req.body.payment_date || new Date().toISOString().split("T")[0];

    if (!isPositiveInteger(purchaseInvoiceId)) {
      return res.status(400).json({
        success: false,
        message: "ID facture fournisseur invalide."
      });
    }

    if (!isPositiveNumber(amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'amount' doit etre > 0."
      });
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message:
          "Le champ 'payment_method' est invalide. Valeurs attendues : cash, mobile_money, bank_transfer, card."
      });
    }

    const purchaseInvoice = await getPurchaseInvoiceById(purchaseInvoiceId);

    if (!purchaseInvoice) {
      return res.status(404).json({
        success: false,
        message: "Facture fournisseur introuvable."
      });
    }

    if (String(purchaseInvoice.status || "").trim().toLowerCase() === "paid") {
      return res.status(400).json({
        success: false,
        message: "Cette facture fournisseur est deja entierement reglee."
      });
    }

    if (Number(purchaseInvoice.balance_due || 0) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Cette facture fournisseur ne presente plus de solde a payer."
      });
    }

    if (amount > Number(purchaseInvoice.balance_due || 0)) {
      return res.status(400).json({
        success: false,
        message: "Le montant paye depasse le solde restant de la facture fournisseur."
      });
    }

    const supplierPayment = await createSupplierPayment({
      supplier_id: purchaseInvoice.supplier_id,
      purchase_invoice_id: purchaseInvoice.id,
      payment_date: paymentDate,
      amount,
      payment_method: paymentMethod,
      reference: req.body.reference?.trim(),
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    const accounting = await ensureSupplierPaymentAccounting(
      supplierPayment,
      purchaseInvoice,
      req.body.accounting || {},
      req.body.created_by ? Number(req.body.created_by) : null
    );

    const refreshedPayment = await getSupplierPaymentById(supplierPayment.id);
    const refreshedPurchaseInvoice = await getPurchaseInvoiceById(purchaseInvoice.id);

    return res.status(201).json({
      success: true,
      message: "Paiement fournisseur enregistre avec succes.",
      data: {
        supplier_payment: {
          ...refreshedPayment,
          accounting_status: accounting.status || null,
          accounting_entry_id: accounting.journal_entry_id || null,
          accounting_message: accounting.reason || null
        },
        purchase_invoice: refreshedPurchaseInvoice,
        accounting
      }
    });
  } catch (error) {
    next(error);
  }
}
