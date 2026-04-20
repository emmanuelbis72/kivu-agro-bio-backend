import { getProductById } from "../models/product.model.js";
import { getWarehouseById } from "../models/warehouse.model.js";
import {
  getWarehouseStock,
  getAllStockSummary,
  getStockMovements,
  getStockTransfers,
  getStockTransferById,
  performStockEntry,
  performStockExit,
  performStockAdjustment,
  performStockTransfer
} from "../models/stock.model.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isNonNegativeInteger(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

async function validateWarehouseAndProduct(warehouseId, productId) {
  const warehouse = await getWarehouseById(warehouseId);
  if (!warehouse) {
    const error = new Error("Dépôt introuvable.");
    error.statusCode = 404;
    throw error;
  }

  const product = await getProductById(productId);
  if (!product) {
    const error = new Error("Produit introuvable.");
    error.statusCode = 404;
    throw error;
  }

  return { warehouse, product };
}

export async function createStockEntryHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const product_id = Number(req.body.product_id);
    const quantity = Number(req.body.quantity);

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'product_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'quantity' doit être un entier positif."
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockEntry({
      warehouse_id,
      product_id,
      quantity,
      unit_cost: Number(req.body.unit_cost ?? 0),
      reference_type: req.body.reference_type?.trim(),
      reference_id: req.body.reference_id ? Number(req.body.reference_id) : null,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Entrée de stock enregistrée avec succès.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function createStockExitHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const product_id = Number(req.body.product_id);
    const quantity = Number(req.body.quantity);

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'product_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'quantity' doit être un entier positif."
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockExit({
      warehouse_id,
      product_id,
      quantity,
      unit_cost: Number(req.body.unit_cost ?? 0),
      reference_type: req.body.reference_type?.trim(),
      reference_id: req.body.reference_id ? Number(req.body.reference_id) : null,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Sortie de stock enregistrée avec succès.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function createStockAdjustmentHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const product_id = Number(req.body.product_id);
    const new_quantity = Number(req.body.new_quantity);

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'product_id' doit être un entier positif."
      });
    }

    if (!isNonNegativeInteger(new_quantity)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'new_quantity' doit être un nombre >= 0."
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockAdjustment({
      warehouse_id,
      product_id,
      new_quantity,
      unit_cost: Number(req.body.unit_cost ?? 0),
      reference_type: req.body.reference_type?.trim(),
      reference_id: req.body.reference_id ? Number(req.body.reference_id) : null,
      notes: req.body.notes?.trim(),
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Ajustement de stock enregistré avec succès.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function createStockTransferHandler(req, res, next) {
  try {
    const source_warehouse_id = Number(req.body.source_warehouse_id);
    const destination_warehouse_id = Number(req.body.destination_warehouse_id);
    const transfer_date = String(
      req.body.transfer_date || new Date().toISOString().split("T")[0]
    ).trim();

    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!isPositiveInteger(source_warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'source_warehouse_id' doit être un entier positif."
      });
    }

    if (!isPositiveInteger(destination_warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'destination_warehouse_id' doit être un entier positif."
      });
    }

    if (source_warehouse_id === destination_warehouse_id) {
      return res.status(400).json({
        success: false,
        message: "Le dépôt source doit être différent du dépôt destination."
      });
    }

    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "Le transfert doit contenir au moins une ligne."
      });
    }

    const sourceWarehouse = await getWarehouseById(source_warehouse_id);
    if (!sourceWarehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt source introuvable."
      });
    }

    const destinationWarehouse = await getWarehouseById(destination_warehouse_id);
    if (!destinationWarehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt destination introuvable."
      });
    }

    const normalizedItems = [];

    for (const rawItem of items) {
      const product_id = Number(rawItem.product_id);
      const quantity = Number(rawItem.quantity);
      const unit_cost = Number(rawItem.unit_cost ?? 0);

      if (!isPositiveInteger(product_id)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit contenir un 'product_id' valide."
        });
      }

      if (!isPositiveInteger(quantity)) {
        return res.status(400).json({
          success: false,
          message: "Chaque ligne doit contenir une 'quantity' entière positive."
        });
      }

      await validateWarehouseAndProduct(source_warehouse_id, product_id);

      normalizedItems.push({
        product_id,
        quantity,
        unit_cost,
        notes: rawItem.notes?.trim() || null
      });
    }

    const result = await performStockTransfer({
      source_warehouse_id,
      destination_warehouse_id,
      transfer_date,
      notes: req.body.notes?.trim() || null,
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      items: normalizedItems
    });

    return res.status(201).json({
      success: true,
      message: "Transfert inter-dépôts enregistré avec succès.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getWarehouseStockHandler(req, res, next) {
  try {
    const warehouseId = Number(req.params.warehouseId);

    if (!isPositiveInteger(warehouseId)) {
      return res.status(400).json({
        success: false,
        message: "ID dépôt invalide."
      });
    }

    const warehouse = await getWarehouseById(warehouseId);

    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt introuvable."
      });
    }

    const stock = await getWarehouseStock(warehouseId);

    return res.status(200).json({
      success: true,
      count: stock.length,
      data: stock
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllStockSummaryHandler(req, res, next) {
  try {
    const stock = await getAllStockSummary();

    return res.status(200).json({
      success: true,
      count: stock.length,
      data: stock
    });
  } catch (error) {
    next(error);
  }
}

export async function getStockMovementsHandler(req, res, next) {
  try {
    const warehouseId = req.query.warehouse_id
      ? Number(req.query.warehouse_id)
      : null;

    const productId = req.query.product_id
      ? Number(req.query.product_id)
      : null;

    const limit = req.query.limit ? Number(req.query.limit) : 100;

    if (warehouseId !== null && !isPositiveInteger(warehouseId)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'warehouse_id' est invalide."
      });
    }

    if (productId !== null && !isPositiveInteger(productId)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'product_id' est invalide."
      });
    }

    if (!isPositiveInteger(limit)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'limit' doit être un entier positif."
      });
    }

    const movements = await getStockMovements({
      warehouseId,
      productId,
      limit
    });

    return res.status(200).json({
      success: true,
      count: movements.length,
      data: movements
    });
  } catch (error) {
    next(error);
  }
}

export async function getStockTransfersHandler(req, res, next) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    if (!isPositiveInteger(limit)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'limit' doit être un entier positif."
      });
    }

    const rows = await getStockTransfers(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getStockTransferByIdHandler(req, res, next) {
  try {
    const transferId = Number(req.params.id);

    if (!isPositiveInteger(transferId)) {
      return res.status(400).json({
        success: false,
        message: "ID transfert invalide."
      });
    }

    const transfer = await getStockTransferById(transferId);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfert introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: transfer
    });
  } catch (error) {
    next(error);
  }
}