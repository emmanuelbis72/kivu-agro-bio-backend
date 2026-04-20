import { getProductById } from "../models/product.model.js";
import { getWarehouseById } from "../models/warehouse.model.js";
import {
  getRecipesByFinishedProduct,
  createOrUpdateRecipeItem,
  deleteRecipeItem,
  getProductionBatches,
  getProductionBatchById,
  createProductionBatch
} from "../models/production.model.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

export async function getRecipesByFinishedProductHandler(req, res, next) {
  try {
    const finishedProductId = Number(req.params.finishedProductId);

    if (!isPositiveInteger(finishedProductId)) {
      return res.status(400).json({
        success: false,
        message: "ID produit fini invalide."
      });
    }

    const finishedProduct = await getProductById(finishedProductId);

    if (!finishedProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit fini introuvable."
      });
    }

    const rows = await getRecipesByFinishedProduct(finishedProductId);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function createOrUpdateRecipeItemHandler(req, res, next) {
  try {
    const finished_product_id = Number(req.body.finished_product_id);
    const component_product_id = Number(req.body.component_product_id);
    const quantity_required = Number(req.body.quantity_required);
    const quantity_unit = normalizeUnit(req.body.quantity_unit);

    if (!isPositiveInteger(finished_product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'finished_product_id' est invalide."
      });
    }

    if (!isPositiveInteger(component_product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'component_product_id' est invalide."
      });
    }

    if (finished_product_id === component_product_id) {
      return res.status(400).json({
        success: false,
        message: "Le composant doit être différent du produit fini."
      });
    }

    if (!isPositiveNumber(quantity_required)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'quantity_required' doit être > 0."
      });
    }

    if (!["g", "kg", "ml", "l", "unit"].includes(quantity_unit)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'quantity_unit' est invalide."
      });
    }

    const finishedProduct = await getProductById(finished_product_id);
    if (!finishedProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit fini introuvable."
      });
    }

    const componentProduct = await getProductById(component_product_id);
    if (!componentProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit composant introuvable."
      });
    }

    const row = await createOrUpdateRecipeItem({
      finished_product_id,
      component_product_id,
      quantity_required,
      quantity_unit
    });

    return res.status(201).json({
      success: true,
      message: "Ligne de recette enregistrée avec succès.",
      data: row
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteRecipeItemHandler(req, res, next) {
  try {
    const recipeId = Number(req.params.id);

    if (!isPositiveInteger(recipeId)) {
      return res.status(400).json({
        success: false,
        message: "ID recette invalide."
      });
    }

    const deleted = await deleteRecipeItem(recipeId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Ligne de recette introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ligne de recette supprimée avec succès.",
      data: deleted
    });
  } catch (error) {
    next(error);
  }
}

export async function createProductionBatchHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const finished_product_id = Number(req.body.finished_product_id);
    const quantity_produced = Number(req.body.quantity_produced);
    const production_date =
      req.body.production_date || new Date().toISOString().split("T")[0];

    if (!isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'warehouse_id' est invalide."
      });
    }

    if (!isPositiveInteger(finished_product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'finished_product_id' est invalide."
      });
    }

    if (!isPositiveNumber(quantity_produced)) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'quantity_produced' doit être > 0."
      });
    }

    const warehouse = await getWarehouseById(warehouse_id);
    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt introuvable."
      });
    }

    const finishedProduct = await getProductById(finished_product_id);
    if (!finishedProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit fini introuvable."
      });
    }

    const batch = await createProductionBatch({
      warehouse_id,
      finished_product_id,
      quantity_produced,
      production_date,
      notes: req.body.notes?.trim() || null,
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Batch de production enregistré avec succès.",
      data: batch
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductionBatchesHandler(req, res, next) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    if (!isPositiveInteger(limit)) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'limit' doit être un entier positif."
      });
    }

    const rows = await getProductionBatches(limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductionBatchByIdHandler(req, res, next) {
  try {
    const batchId = Number(req.params.id);

    if (!isPositiveInteger(batchId)) {
      return res.status(400).json({
        success: false,
        message: "ID batch invalide."
      });
    }

    const batch = await getProductionBatchById(batchId);

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: batch
    });
  } catch (error) {
    next(error);
  }
}