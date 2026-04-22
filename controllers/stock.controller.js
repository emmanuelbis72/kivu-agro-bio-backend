import { getProductById, getProductBySku } from "../models/product.model.js";
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
  performStockTransfer,
  performBulkToPackageTransform,
  performStockMixture
} from "../models/stock.model.js";

const ALLOWED_STOCK_FORMS = ["bulk", "package"];
const ALLOWED_UNITS = ["g", "kg", "ml", "l", "unit", "piece"];
const FINISHED_PRODUCT_ROLE = "finished_product";
const PACKAGING_ROLE = "packaging_material";

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function isNonNegativeNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function normalizeStockForm(value) {
  return String(value || "bulk").trim().toLowerCase();
}

function normalizeUnit(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function parseVariantPayload(body) {
  const stock_form = normalizeStockForm(body.stock_form);
  const package_size =
    body.package_size === undefined || body.package_size === null || body.package_size === ""
      ? null
      : Number(body.package_size);
  const package_unit = normalizeUnit(body.package_unit);

  return {
    stock_form,
    package_size,
    package_unit
  };
}

function validateVariant(variant, errors, label = "stock") {
  if (!ALLOWED_STOCK_FORMS.includes(variant.stock_form)) {
    errors.push(`Le champ '${label}_form' / 'stock_form' est invalide.`);
    return;
  }

  if (variant.stock_form === "package") {
    if (!isPositiveNumber(variant.package_size)) {
      errors.push("Le champ 'package_size' doit être > 0 pour un stock en paquet.");
    }

    if (!variant.package_unit || !ALLOWED_UNITS.includes(variant.package_unit)) {
      errors.push("Le champ 'package_unit' est obligatoire et invalide pour un stock en paquet.");
    }
  }
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
    const variant = parseVariantPayload(req.body);
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' doit être un entier positif.");
    }

    if (!isPositiveInteger(product_id)) {
      errors.push("Le champ 'product_id' doit être un entier positif.");
    }

    if (!isPositiveNumber(quantity)) {
      errors.push("Le champ 'quantity' doit être un nombre > 0.");
    }

    validateVariant(variant, errors);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockEntry({
      warehouse_id,
      product_id,
      quantity,
      ...variant,
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
    const variant =
      req.body.stock_form === undefined
        ? {}
        : parseVariantPayload(req.body);
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' doit être un entier positif.");
    }

    if (!isPositiveInteger(product_id)) {
      errors.push("Le champ 'product_id' doit être un entier positif.");
    }

    if (!isPositiveNumber(quantity)) {
      errors.push("Le champ 'quantity' doit être un nombre > 0.");
    }

    if (variant.stock_form) {
      validateVariant(
        {
          stock_form: variant.stock_form,
          package_size: variant.package_size,
          package_unit: variant.package_unit
        },
        errors
      );
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockExit({
      warehouse_id,
      product_id,
      quantity,
      ...variant,
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
    const variant = parseVariantPayload(req.body);
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' doit être un entier positif.");
    }

    if (!isPositiveInteger(product_id)) {
      errors.push("Le champ 'product_id' doit être un entier positif.");
    }

    if (!isNonNegativeNumber(new_quantity)) {
      errors.push("Le champ 'new_quantity' doit être un nombre >= 0.");
    }

    validateVariant(variant, errors);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    await validateWarehouseAndProduct(warehouse_id, product_id);

    const result = await performStockAdjustment({
      warehouse_id,
      product_id,
      new_quantity,
      ...variant,
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
      const variant = parseVariantPayload(rawItem);
      const unit_cost = Number(rawItem.unit_cost ?? 0);
      const errors = [];

      if (!isPositiveInteger(product_id)) {
        errors.push("Chaque ligne doit contenir un 'product_id' valide.");
      }

      if (!isPositiveNumber(quantity)) {
        errors.push("Chaque ligne doit contenir une 'quantity' > 0.");
      }

      validateVariant(variant, errors);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation échouée sur une ligne de transfert.",
          errors
        });
      }

      await validateWarehouseAndProduct(source_warehouse_id, product_id);

      normalizedItems.push({
        product_id,
        quantity,
        ...variant,
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

export async function createBulkToPackageTransformHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const source_product_id = Number(req.body.source_product_id);
    const target_product_id = Number(req.body.target_product_id);
    const source_quantity = Number(req.body.source_quantity);
    const target_quantity = Number(req.body.target_quantity);
    const package_size = Number(req.body.package_size);
    const package_unit = normalizeUnit(req.body.package_unit);
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' est invalide.");
    }

    if (!isPositiveInteger(source_product_id)) {
      errors.push("Le champ 'source_product_id' est invalide.");
    }

    if (!isPositiveInteger(target_product_id)) {
      errors.push("Le champ 'target_product_id' est invalide.");
    }

    if (!isPositiveNumber(source_quantity)) {
      errors.push("Le champ 'source_quantity' doit être > 0.");
    }

    if (!isPositiveNumber(target_quantity)) {
      errors.push("Le champ 'target_quantity' doit être > 0.");
    }

    if (!isPositiveNumber(package_size)) {
      errors.push("Le champ 'package_size' doit être > 0.");
    }

    if (!package_unit || !ALLOWED_UNITS.includes(package_unit)) {
      errors.push("Le champ 'package_unit' est invalide.");
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const { product: sourceProduct } = await validateWarehouseAndProduct(
      warehouse_id,
      source_product_id
    );
    const { product: targetProduct } = await validateWarehouseAndProduct(
      warehouse_id,
      target_product_id
    );

    if (targetProduct.product_role !== FINISHED_PRODUCT_ROLE) {
      return res.status(400).json({
        success: false,
        message: "Le produit cible du paquetage doit être un produit fini."
      });
    }

    if (sourceProduct.product_role === PACKAGING_ROLE) {
      return res.status(400).json({
        success: false,
        message: "Un emballage ne peut pas être utilisé comme stock source à conditionner."
      });
    }

    const result = await performBulkToPackageTransform({
      warehouse_id,
      source_product_id,
      target_product_id,
      source_quantity,
      target_quantity,
      package_size,
      package_unit,
      unit_cost: Number(req.body.unit_cost ?? 0),
      notes: req.body.notes?.trim() || null,
      created_by: req.body.created_by ? Number(req.body.created_by) : null
    });

    return res.status(201).json({
      success: true,
      message: "Transformation du vrac en paquet enregistrée avec succès.",
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function createStockMixtureHandler(req, res, next) {
  try {
    const warehouse_id = Number(req.body.warehouse_id);
    const target_product_id = Number(req.body.target_product_id);
    const hasTargetProductId = isPositiveInteger(target_product_id);
    const target_product =
      req.body.target_product && typeof req.body.target_product === "object"
        ? req.body.target_product
        : null;
    const target_quantity = Number(req.body.target_quantity);
    const target_stock_form = normalizeStockForm(req.body.target_stock_form || "bulk");
    const package_size =
      req.body.package_size === undefined || req.body.package_size === null || req.body.package_size === ""
        ? null
        : Number(req.body.package_size);
    const package_unit = normalizeUnit(req.body.package_unit);
    const components = Array.isArray(req.body.components) ? req.body.components : [];
    const errors = [];

    if (!isPositiveInteger(warehouse_id)) {
      errors.push("Le champ 'warehouse_id' est invalide.");
    }

    if (!hasTargetProductId && !target_product) {
      errors.push(
        "Veuillez sélectionner un produit cible existant ou renseigner les informations du nouveau produit mixture."
      );
    }

    if (!isPositiveNumber(target_quantity)) {
      errors.push("Le champ 'target_quantity' doit être > 0.");
    }

    if (!components.length) {
      errors.push("Le mélange doit contenir au moins un composant.");
    }

    validateVariant(
      {
        stock_form: target_stock_form,
        package_size,
        package_unit
      },
      errors,
      "target_stock"
    );

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    if (hasTargetProductId) {
      const { product: targetProduct } = await validateWarehouseAndProduct(
        warehouse_id,
        target_product_id
      );

      if (targetProduct.product_role !== FINISHED_PRODUCT_ROLE) {
        return res.status(400).json({
          success: false,
          message: "Le produit cible de la mixture doit être un produit fini."
        });
      }
    } else if (target_product) {
      if (!target_product.name || String(target_product.name).trim() === "") {
        errors.push("Le nom du nouveau produit mixture est obligatoire.");
      }

      if (!target_product.sku || String(target_product.sku).trim() === "") {
        errors.push("Le SKU du nouveau produit mixture est obligatoire.");
      }

      if (
        target_product.selling_price !== undefined &&
        target_product.selling_price !== "" &&
        !isNonNegativeNumber(target_product.selling_price)
      ) {
        errors.push("Le prix de vente du nouveau produit mixture est invalide.");
      }

      if (
        target_product.alert_threshold !== undefined &&
        target_product.alert_threshold !== "" &&
        !isNonNegativeNumber(target_product.alert_threshold)
      ) {
        errors.push("Le seuil d'alerte du nouveau produit mixture est invalide.");
      }

      if (!errors.length) {
        const existingProduct = await getProductBySku(String(target_product.sku).trim());

        if (existingProduct) {
          errors.push("Un produit existe déjà avec le SKU du nouveau produit mixture.");
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const normalizedComponents = [];

    for (const rawComponent of components) {
      const product_id = Number(rawComponent.product_id);
      const quantity = Number(rawComponent.quantity);

      if (!isPositiveInteger(product_id)) {
        return res.status(400).json({
          success: false,
          message: "Chaque composant doit contenir un 'product_id' valide."
        });
      }

      if (!isPositiveNumber(quantity)) {
        return res.status(400).json({
          success: false,
          message: "Chaque composant doit contenir une 'quantity' > 0."
        });
      }

      const { product: componentProduct } = await validateWarehouseAndProduct(
        warehouse_id,
        product_id
      );

      if (componentProduct.product_role === PACKAGING_ROLE) {
        return res.status(400).json({
          success: false,
          message:
            "Les emballages ne peuvent pas être utilisés comme composants de mixture."
        });
      }

      normalizedComponents.push({
        product_id,
        quantity,
        unit_cost: Number(rawComponent.unit_cost ?? 0)
      });
    }

    const result = await performStockMixture({
      warehouse_id,
      target_product_id: hasTargetProductId ? target_product_id : null,
      target_product: hasTargetProductId
        ? null
        : {
            name: String(target_product.name).trim(),
            sku: String(target_product.sku).trim(),
            category: target_product.category?.trim() || null,
            barcode: target_product.barcode?.trim() || null,
            unit: target_product.unit?.trim() || "piece",
            selling_price:
              target_product.selling_price === undefined ||
              target_product.selling_price === ""
                ? 0
                : Number(target_product.selling_price),
            alert_threshold:
              target_product.alert_threshold === undefined ||
              target_product.alert_threshold === ""
                ? 0
                : Number(target_product.alert_threshold),
            description: target_product.description?.trim() || null,
            is_active:
              target_product.is_active === undefined
                ? true
                : Boolean(target_product.is_active)
          },
      target_quantity,
      target_stock_form,
      package_size,
      package_unit,
      unit_cost: Number(req.body.unit_cost ?? 0),
      notes: req.body.notes?.trim() || null,
      created_by: req.body.created_by ? Number(req.body.created_by) : null,
      components: normalizedComponents
    });

    return res.status(201).json({
      success: true,
      message: "Création du produit mixture enregistrée avec succès.",
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
