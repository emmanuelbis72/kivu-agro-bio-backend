import { getCustomerById } from "../models/customer.model.js";
import { getProductById } from "../models/product.model.js";
import { getWarehouseById } from "../models/warehouse.model.js";
import {
  getInvoiceById,
  getAllInvoices,
  getNextInvoiceNumberForDate,
  createInvoiceWithItems,
  updateInvoiceWithItems,
  deleteInvoiceById
} from "../models/invoice.model.js";
import { autoPostInvoiceEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) >= 0;
}

function normalizeBusinessDate(value, fieldLabel, { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (required) {
      return {
        error: `Le champ '${fieldLabel}' est obligatoire.`
      };
    }

    return { value: null };
  }

  const normalized = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      error: `Le champ '${fieldLabel}' doit etre au format YYYY-MM-DD.`
    };
  }

  const [year, month, day] = normalized.split("-").map(Number);

  if (year < 2000 || year > 2100) {
    return {
      error: `Le champ '${fieldLabel}' doit avoir une annee comprise entre 2000 et 2100.`
    };
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return {
      error: `Le champ '${fieldLabel}' contient une date invalide.`
    };
  }

  return { value: normalized };
}

function normalizeStockForm(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value).trim().toLowerCase();
}

function normalizeUnit(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value).trim().toLowerCase();
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().split("T")[0];
}

export async function createInvoiceHandler(req, res, next) {
  try {
    const customer_id = Number(req.body.customer_id);
    const warehouse_id = Number(req.body.warehouse_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const normalizedInvoiceDate = normalizeBusinessDate(
      req.body.invoice_date || new Date().toISOString().split("T")[0],
      "invoice_date",
      { required: true }
    );

    if (normalizedInvoiceDate.error) {
      return res.status(400).json({
        success: false,
        message: normalizedInvoiceDate.error
      });
    }

    const invoice_date = normalizedInvoiceDate.value;

    if (!isPositiveInteger(customer_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'customer_id' est invalide."
      });
    }

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' est invalide."
      });
    }

    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "La facture doit contenir au moins une ligne."
      });
    }

    const customer = await getCustomerById(customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable."
      });
    }

    const warehouse = await getWarehouseById(warehouse_id);
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Depot introuvable."
      });
    }

    if (
      customer.warehouse_id !== undefined &&
      customer.warehouse_id !== null &&
      Number(customer.warehouse_id) !== warehouse_id
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Le depot selectionne ne correspond pas au depot lie a ce client."
      });
    }

    let subtotal = 0;
    const normalizedItems = [];

    for (const rawItem of items) {
      const product_id = Number(rawItem.product_id);
      const quantity = Number(rawItem.quantity);
      const unit_price = Number(rawItem.unit_price);

      if (!isPositiveInteger(product_id)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir un 'product_id' valide."
        });
      }

      if (!isPositiveInteger(quantity)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir une 'quantity' entiere positive."
        });
      }

      if (!isNonNegativeNumber(unit_price)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir un 'unit_price' >= 0."
        });
      }

      const product = await getProductById(product_id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Produit introuvable pour l'ID ${product_id}.`
        });
      }

      if (product.product_role !== "finished_product") {
        return res.status(400).json({
          success: false,
          message:
            "Seuls les produits finis peuvent etre vendus et factures aux clients."
        });
      }

      const line_total = Number(quantity) * Number(unit_price);
      subtotal += line_total;

      normalizedItems.push({
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost: Number(product.cost_price ?? 0),
        stock_form: null,
        package_size: null,
        package_unit: null
      });
    }

    const discount_amount = Number(req.body.discount_amount ?? 0);
    const tax_amount = Number(req.body.tax_amount ?? 0);

    if (!isNonNegativeNumber(discount_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'discount_amount' doit etre >= 0."
      });
    }

    if (!isNonNegativeNumber(tax_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'tax_amount' doit etre >= 0."
      });
    }

    if (discount_amount > subtotal) {
      return res.status(400).json({
        success: false,
        message: "La remise ne peut pas etre superieure au sous-total."
      });
    }

    const total_amount = subtotal - discount_amount + tax_amount;

    if (total_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Le total de la facture est invalide."
      });
    }

    const normalizedDueDate = normalizeBusinessDate(
      req.body.due_date || addDays(invoice_date, customer.payment_terms_days),
      "due_date",
      { required: true }
    );

    if (normalizedDueDate.error) {
      return res.status(400).json({
        success: false,
        message: normalizedDueDate.error
      });
    }

    const due_date = normalizedDueDate.value;
    const invoice_number = await getNextInvoiceNumberForDate(invoice_date);

    const invoice = await createInvoiceWithItems({
      invoice_number,
      customer_id,
      customer_name: customer.business_name,
      warehouse_id,
      invoice_date,
      due_date,
      status: "issued",
      subtotal,
      discount_amount,
      tax_amount,
      total_amount,
      paid_amount: 0,
      balance_due: total_amount,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    let accounting = {
      status: "skipped",
      reason: "Aucune tentative de comptabilisation."
    };

    if (invoice.accounting_entry_id) {
      accounting = {
        status: "skipped",
        reason: "Facture deja comptabilisee."
      };
    } else {
      try {
        accounting = await autoPostInvoiceEntry({
          invoice,
          accounting: req.body.accounting || {},
          created_by: req.body.created_by ? Number(req.body.created_by) : null
        });
      } catch (accountingError) {
        accounting = {
          status: "error",
          reason: accountingError.message
        };
      }
    }

    await persistAccountingStatus({
      tableName: "invoices",
      recordId: invoice.id,
      accountingResult: accounting
    });

    return res.status(201).json({
      success: true,
      message: "Facture creee avec succes.",
      data: {
        invoice: {
          ...invoice,
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

export async function updateInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture invalide."
      });
    }

    const existingInvoice = await getInvoiceById(id);

    if (!existingInvoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    const customer_id = Number(req.body.customer_id);
    const warehouse_id = Number(req.body.warehouse_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const normalizedInvoiceDate = normalizeBusinessDate(
      req.body.invoice_date || new Date().toISOString().split("T")[0],
      "invoice_date",
      { required: true }
    );

    if (normalizedInvoiceDate.error) {
      return res.status(400).json({
        success: false,
        message: normalizedInvoiceDate.error
      });
    }

    const invoice_date = normalizedInvoiceDate.value;

    if (!isPositiveInteger(customer_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'customer_id' est invalide."
      });
    }

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' est invalide."
      });
    }

    if (items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "La facture doit contenir au moins une ligne."
      });
    }

    const customer = await getCustomerById(customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Client introuvable."
      });
    }

    const warehouse = await getWarehouseById(warehouse_id);
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Depot introuvable."
      });
    }

    if (
      customer.warehouse_id !== undefined &&
      customer.warehouse_id !== null &&
      Number(customer.warehouse_id) !== warehouse_id
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Le depot selectionne ne correspond pas au depot lie a ce client."
      });
    }

    let subtotal = 0;
    const normalizedItems = [];

    for (const rawItem of items) {
      const product_id = Number(rawItem.product_id);
      const quantity = Number(rawItem.quantity);
      const unit_price = Number(rawItem.unit_price);

      if (!isPositiveInteger(product_id)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir un 'product_id' valide."
        });
      }

      if (!isPositiveInteger(quantity)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir une 'quantity' entiere positive."
        });
      }

      if (!isNonNegativeNumber(unit_price)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit avoir un 'unit_price' >= 0."
        });
      }

      const product = await getProductById(product_id);

      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Produit introuvable pour l'ID ${product_id}.`
        });
      }

      if (product.product_role !== "finished_product") {
        return res.status(400).json({
          success: false,
          message:
            "Seuls les produits finis peuvent etre vendus et factures aux clients."
        });
      }

      const line_total = Number(quantity) * Number(unit_price);
      subtotal += line_total;

      normalizedItems.push({
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost: Number(product.cost_price ?? 0),
        stock_form: null,
        package_size: null,
        package_unit: null
      });
    }

    const discount_amount = Number(req.body.discount_amount ?? 0);
    const tax_amount = Number(req.body.tax_amount ?? 0);

    if (!isNonNegativeNumber(discount_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'discount_amount' doit etre >= 0."
      });
    }

    if (!isNonNegativeNumber(tax_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'tax_amount' doit etre >= 0."
      });
    }

    if (discount_amount > subtotal) {
      return res.status(400).json({
        success: false,
        message: "La remise ne peut pas etre superieure au sous-total."
      });
    }

    const total_amount = subtotal - discount_amount + tax_amount;

    if (total_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Le total de la facture est invalide."
      });
    }

    const normalizedDueDate = normalizeBusinessDate(
      req.body.due_date || addDays(invoice_date, customer.payment_terms_days),
      "due_date",
      { required: true }
    );

    if (normalizedDueDate.error) {
      return res.status(400).json({
        success: false,
        message: normalizedDueDate.error
      });
    }

    const due_date = normalizedDueDate.value;

    const invoice = await updateInvoiceWithItems(id, {
      customer_id,
      customer_name: customer.business_name,
      warehouse_id,
      invoice_date,
      due_date,
      subtotal,
      discount_amount,
      tax_amount,
      total_amount,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    let accounting = {
      status: "skipped",
      reason: "Facture modifiee. Comptabilisation a relancer si necessaire."
    };

    try {
      accounting = await autoPostInvoiceEntry({
        invoice,
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
      tableName: "invoices",
      recordId: invoice.id,
      accountingResult: accounting
    });

    return res.status(200).json({
      success: true,
      message: "Facture modifiee avec succes.",
      data: {
        invoice: {
          ...invoice,
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

export async function deleteInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture invalide."
      });
    }

    const deletedInvoice = await deleteInvoiceById(id);

    if (!deletedInvoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Facture supprimee avec succes.",
      data: deletedInvoice
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllInvoicesHandler(req, res, next) {
  try {
    const invoices = await getAllInvoices();

    return res.status(200).json({
      success: true,
      count: invoices.length,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
}

export async function getInvoiceByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID facture invalide."
      });
    }

    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Facture introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
}
