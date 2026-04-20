import { getCustomerById } from "../models/customer.model.js";
import { getProductById } from "../models/product.model.js";
import { getWarehouseById } from "../models/warehouse.model.js";
import {
  getInvoiceById,
  getAllInvoices,
  getNextInvoiceNumber,
  createInvoiceWithItems
} from "../models/invoice.model.js";
import { autoPostInvoiceEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) >= 0;
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().split("T")[0];
}

export async function createInvoiceHandler(req, res, next) {
  try {
    const customer_id = Number(req.body.customer_id);
    const warehouse_id = Number(req.body.warehouse_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const invoice_date =
      req.body.invoice_date || new Date().toISOString().split("T")[0];

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
        message: "Dépôt introuvable."
      });
    }

    if (
      customer.warehouse_id !== undefined &&
      customer.warehouse_id !== null &&
      Number(customer.warehouse_id) !== warehouse_id
    ) {
      return res.status(400).json({
        success: false,
        message: "Le dépôt sélectionné ne correspond pas au dépôt lié à ce client."
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
          message: "Chaque ligne doit avoir une 'quantity' entière positive."
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

      const line_total = Number(quantity) * Number(unit_price);
      subtotal += line_total;

      normalizedItems.push({
        product_id,
        quantity,
        unit_price,
        line_total,
        unit_cost: Number(product.cost_price ?? 0)
      });
    }

    const discount_amount = Number(req.body.discount_amount ?? 0);
    const tax_amount = Number(req.body.tax_amount ?? 0);

    if (!isNonNegativeNumber(discount_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'discount_amount' doit être >= 0."
      });
    }

    if (!isNonNegativeNumber(tax_amount)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'tax_amount' doit être >= 0."
      });
    }

    if (discount_amount > subtotal) {
      return res.status(400).json({
        success: false,
        message: "La remise ne peut pas être supérieure au sous-total."
      });
    }

    const total_amount = subtotal - discount_amount + tax_amount;

    if (total_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Le total de la facture est invalide."
      });
    }

    const due_date =
      req.body.due_date || addDays(invoice_date, customer.payment_terms_days);
    const invoice_number = await getNextInvoiceNumber();

    const invoice = await createInvoiceWithItems({
      invoice_number,
      customer_id,
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
        reason: "Facture déjà comptabilisée."
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
      message: "Facture créée avec succès.",
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