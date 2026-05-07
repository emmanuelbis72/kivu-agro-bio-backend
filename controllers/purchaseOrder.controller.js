import {
  createPurchaseOrderWithItems,
  deletePurchaseOrderById,
  getAllPurchaseOrders,
  getNextPurchaseOrderNumberForDate,
  getPurchaseOrderById,
  receivePurchaseOrderItems,
  updatePurchaseOrderWithItems
} from "../models/purchaseOrder.model.js";
import { autoPostPurchaseInvoiceEntry } from "../services/accountingAutoPost.service.js";
import { persistAccountingStatus } from "../services/accountingStatus.service.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return !Number.isNaN(Number(value)) && Number(value) > 0;
}

function validatePurchaseOrderPayload(body) {
  const errors = [];

  if (!isPositiveInteger(body.supplier_id)) {
    errors.push("Le champ 'supplier_id' est obligatoire.");
  }

  if (!isPositiveInteger(body.warehouse_id)) {
    errors.push("Le champ 'warehouse_id' est obligatoire.");
  }

  if (!body.order_date || String(body.order_date).trim() === "") {
    errors.push("Le champ 'order_date' est obligatoire.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    errors.push("Ajoute au moins une ligne de commande.");
  }

  for (const item of body.items || []) {
    if (!isPositiveInteger(item.product_id)) {
      errors.push("Chaque ligne doit avoir un produit valide.");
      break;
    }

    if (!isPositiveNumber(item.ordered_quantity)) {
      errors.push("Chaque ligne doit avoir une quantite commandee positive.");
      break;
    }

    if (Number.isNaN(Number(item.unit_cost)) || Number(item.unit_cost) < 0) {
      errors.push("Chaque ligne doit avoir un cout unitaire valide.");
      break;
    }
  }

  return errors;
}

async function ensureReceivedPurchaseInvoiceAccounting(
  purchaseInvoice,
  accounting = {},
  created_by = null
) {
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

export async function createPurchaseOrderHandler(req, res, next) {
  try {
    const errors = validatePurchaseOrderPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const normalizedItems = req.body.items.map((item) => ({
      product_id: Number(item.product_id),
      ordered_quantity: Number(item.ordered_quantity),
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.ordered_quantity) * Number(item.unit_cost)
    }));

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0
    );
    const taxAmount = Number(req.body.tax_amount || 0);
    const totalAmount = subtotal + taxAmount;
    const purchaseOrderNumber =
      req.body.purchase_order_number?.trim() ||
      (await getNextPurchaseOrderNumberForDate(req.body.order_date));

    const purchaseOrder = await createPurchaseOrderWithItems({
      purchase_order_number: purchaseOrderNumber,
      supplier_id: Number(req.body.supplier_id),
      warehouse_id: Number(req.body.warehouse_id),
      order_date: req.body.order_date,
      expected_date: req.body.expected_date || null,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    return res.status(201).json({
      success: true,
      message: "Commande d'achat creee avec succes.",
      data: purchaseOrder
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllPurchaseOrdersHandler(req, res, next) {
  try {
    const purchaseOrders = await getAllPurchaseOrders();

    return res.status(200).json({
      success: true,
      count: purchaseOrders.length,
      data: purchaseOrders
    });
  } catch (error) {
    next(error);
  }
}

export async function getPurchaseOrderByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID commande d'achat invalide."
      });
    }

    const purchaseOrder = await getPurchaseOrderById(id);

    if (!purchaseOrder) {
      return res.status(404).json({
        success: false,
        message: "Commande d'achat introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: purchaseOrder
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePurchaseOrderHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID commande d'achat invalide."
      });
    }

    const errors = validatePurchaseOrderPayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const normalizedItems = req.body.items.map((item) => ({
      product_id: Number(item.product_id),
      ordered_quantity: Number(item.ordered_quantity),
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.ordered_quantity) * Number(item.unit_cost)
    }));

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + Number(item.line_total || 0),
      0
    );
    const taxAmount = Number(req.body.tax_amount || 0);
    const totalAmount = subtotal + taxAmount;

    const purchaseOrder = await updatePurchaseOrderWithItems(id, {
      supplier_id: Number(req.body.supplier_id),
      warehouse_id: Number(req.body.warehouse_id),
      order_date: req.body.order_date,
      expected_date: req.body.expected_date || null,
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      notes: req.body.notes?.trim(),
      items: normalizedItems
    });

    return res.status(200).json({
      success: true,
      message: "Commande d'achat mise a jour avec succes.",
      data: purchaseOrder
    });
  } catch (error) {
    next(error);
  }
}

export async function deletePurchaseOrderHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID commande d'achat invalide."
      });
    }

    const deletedPurchaseOrder = await deletePurchaseOrderById(id);

    if (!deletedPurchaseOrder) {
      return res.status(404).json({
        success: false,
        message: "Commande d'achat introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Commande d'achat supprimee avec succes.",
      data: deletedPurchaseOrder
    });
  } catch (error) {
    next(error);
  }
}

export async function receivePurchaseOrderHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!isPositiveInteger(id)) {
      return res.status(400).json({
        success: false,
        message: "ID commande d'achat invalide."
      });
    }

    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Ajoute au moins une ligne de reception."
      });
    }

    const normalizedItems = req.body.items.map((item) => ({
      purchase_order_item_id: Number(item.purchase_order_item_id),
      received_quantity: Number(item.received_quantity),
      unit_cost:
        item.unit_cost === undefined || item.unit_cost === null || item.unit_cost === ""
          ? null
          : Number(item.unit_cost)
    }));

    const invalidItem = normalizedItems.find(
      (item) =>
        !isPositiveInteger(item.purchase_order_item_id) ||
        Number.isNaN(item.received_quantity) ||
        Number(item.received_quantity) < 0 ||
        (item.unit_cost !== null && (Number.isNaN(item.unit_cost) || item.unit_cost < 0))
    );

    if (invalidItem) {
      return res.status(400).json({
        success: false,
        message:
          "Chaque ligne de reception doit avoir une ligne commande valide, une quantite positive ou nulle et un cout correct."
      });
    }

    const result = await receivePurchaseOrderItems(id, {
      invoice_date:
        req.body.invoice_date || new Date().toISOString().split("T")[0],
      due_date: req.body.due_date || null,
      tax_amount: Number(req.body.tax_amount || 0),
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    const accounting = await ensureReceivedPurchaseInvoiceAccounting(
      result.purchase_invoice,
      req.body.accounting || {},
      req.body.created_by ? Number(req.body.created_by) : null
    );

    return res.status(201).json({
      success: true,
      message: "Reception de commande enregistree avec succes.",
      data: {
        purchase_order: result.purchase_order,
        purchase_invoice: {
          ...result.purchase_invoice,
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
