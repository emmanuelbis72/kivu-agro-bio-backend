import { getProductById } from "../models/product.model.js";
import { getWarehouseById } from "../models/warehouse.model.js";
import {
  createPackagingConsumption,
  getPackagingConsumptions,
  getPackagingOverview,
  getPackagingProducts,
  PACKAGING_CONSUMER_TYPES,
  PACKAGING_PURPOSES,
  PACKAGING_TYPES,
  updatePackagingProductType
} from "../models/packaging.model.js";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function normalizeDate(value) {
  return String(value || new Date().toISOString().split("T")[0]).trim();
}

export async function getPackagingProductsHandler(req, res, next) {
  try {
    const rows = await getPackagingProducts();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function updatePackagingProductTypeHandler(req, res, next) {
  try {
    const productId = Number(req.params.productId);
    const packagingType = normalizeOptionalString(req.body.packaging_type);

    if (!isPositiveInteger(productId)) {
      return res.status(400).json({
        success: false,
        message: "ID produit emballage invalide."
      });
    }

    if (packagingType && !PACKAGING_TYPES.includes(packagingType)) {
      return res.status(400).json({
        success: false,
        message:
          "Le champ 'packaging_type' est invalide. Valeurs attendues: oil_bottle, butter_bottle, kraft_paper."
      });
    }

    const product = await updatePackagingProductType(productId, packagingType);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Produit emballage introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Type d'emballage mis a jour avec succes.",
      data: product
    });
  } catch (error) {
    next(error);
  }
}

export async function createPackagingConsumptionHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const product_id = Number(req.body.product_id);
    const quantity = Number(req.body.quantity);
    const packaging_type = normalizeOptionalString(req.body.packaging_type);
    const consumer_name = String(req.body.consumer_name || "").trim();
    const consumer_type = normalizeOptionalString(req.body.consumer_type);
    const purpose = normalizeOptionalString(req.body.purpose);
    const consumption_date = normalizeDate(req.body.consumption_date);
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' doit etre un entier positif.");
    }

    if (!isPositiveInteger(product_id)) {
      errors.push("Le champ 'product_id' doit etre un entier positif.");
    }

    if (!isPositiveNumber(quantity)) {
      errors.push("Le champ 'quantity' doit etre un nombre > 0.");
    }

    if (!consumer_name) {
      errors.push("Le champ 'consumer_name' est obligatoire.");
    }

    if (packaging_type && !PACKAGING_TYPES.includes(packaging_type)) {
      errors.push(
        "Le champ 'packaging_type' est invalide. Valeurs attendues: oil_bottle, butter_bottle, kraft_paper."
      );
    }

    if (consumer_type && !PACKAGING_CONSUMER_TYPES.includes(consumer_type)) {
      errors.push(
        "Le champ 'consumer_type' est invalide. Valeurs attendues: commercial, production, logistics, administration, client, other."
      );
    }

    if (purpose && !PACKAGING_PURPOSES.includes(purpose)) {
      errors.push(
        "Le champ 'purpose' est invalide. Valeurs attendues: conditioning, delivery, sampling, internal_use, loss, other."
      );
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation echouee.",
        errors
      });
    }

    const [warehouse, product] = await Promise.all([
      getWarehouseById(warehouse_id),
      getProductById(product_id)
    ]);

    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Depot introuvable."
      });
    }

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Produit emballage introuvable."
      });
    }

    const result = await createPackagingConsumption({
      warehouse_id,
      product_id,
      quantity,
      packaging_type,
      consumer_name,
      consumer_type,
      purpose,
      consumption_date,
      notes: req.body.notes?.trim() || null,
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Consommation d'emballage enregistree avec succes.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getPackagingConsumptionsHandler(req, res, next) {
  try {
    const warehouse_id = req.query.warehouse_id
      ? Number(req.query.warehouse_id)
      : null;
    const product_id = req.query.product_id ? Number(req.query.product_id) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const packaging_type = normalizeOptionalString(req.query.packaging_type);
    const consumer_type = normalizeOptionalString(req.query.consumer_type);

    if (warehouse_id !== null && !isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'warehouse_id' est invalide."
      });
    }

    if (product_id !== null && !isPositiveInteger(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'product_id' est invalide."
      });
    }

    if (!isPositiveInteger(limit)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'limit' doit etre un entier positif."
      });
    }

    if (packaging_type && !PACKAGING_TYPES.includes(packaging_type)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'packaging_type' est invalide."
      });
    }

    if (consumer_type && !PACKAGING_CONSUMER_TYPES.includes(consumer_type)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'consumer_type' est invalide."
      });
    }

    const rows = await getPackagingConsumptions({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      warehouse_id,
      product_id,
      packaging_type,
      consumer_name: req.query.consumer_name || null,
      consumer_type,
      limit
    });

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getPackagingOverviewHandler(req, res, next) {
  try {
    const warehouse_id = req.query.warehouse_id
      ? Number(req.query.warehouse_id)
      : null;
    const product_id = req.query.product_id ? Number(req.query.product_id) : null;
    const packaging_type = normalizeOptionalString(req.query.packaging_type);
    const consumer_type = normalizeOptionalString(req.query.consumer_type);

    if (warehouse_id !== null && !isPositiveInteger(warehouse_id)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'warehouse_id' est invalide."
      });
    }

    if (product_id !== null && !isPositiveInteger(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'product_id' est invalide."
      });
    }

    if (packaging_type && !PACKAGING_TYPES.includes(packaging_type)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'packaging_type' est invalide."
      });
    }

    if (consumer_type && !PACKAGING_CONSUMER_TYPES.includes(consumer_type)) {
      return res.status(400).json({
        success: false,
        message: "Le parametre 'consumer_type' est invalide."
      });
    }

    const data = await getPackagingOverview({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      warehouse_id,
      product_id,
      packaging_type,
      consumer_name: req.query.consumer_name || null,
      consumer_type
    });

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}
