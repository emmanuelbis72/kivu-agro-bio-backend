import {
  createProduct,
  getAllProducts,
  getProductById,
  getProductBySku,
  updateProduct,
  deleteProduct
} from "../models/product.model.js";

function validateProductPayload(body) {
  const errors = [];

  if (!body.name || String(body.name).trim() === "") {
    errors.push("Le champ 'name' est obligatoire.");
  }

  if (!body.sku || String(body.sku).trim() === "") {
    errors.push("Le champ 'sku' est obligatoire.");
  }

  if (
    body.cost_price !== undefined &&
    (isNaN(body.cost_price) || Number(body.cost_price) < 0)
  ) {
    errors.push("Le champ 'cost_price' doit être un nombre >= 0.");
  }

  if (
    body.selling_price !== undefined &&
    (isNaN(body.selling_price) || Number(body.selling_price) < 0)
  ) {
    errors.push("Le champ 'selling_price' doit être un nombre >= 0.");
  }

  if (
    body.alert_threshold !== undefined &&
    (!Number.isInteger(Number(body.alert_threshold)) ||
      Number(body.alert_threshold) < 0)
  ) {
    errors.push("Le champ 'alert_threshold' doit être un entier >= 0.");
  }

  if (
    body.sales_account_id !== undefined &&
    body.sales_account_id !== null &&
    body.sales_account_id !== "" &&
    (!Number.isInteger(Number(body.sales_account_id)) ||
      Number(body.sales_account_id) <= 0)
  ) {
    errors.push("Le champ 'sales_account_id' doit être un entier positif ou nul.");
  }

  return errors;
}

export async function createProductHandler(req, res, next) {
  try {
    const errors = validateProductPayload(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const existingProduct = await getProductBySku(req.body.sku.trim());
    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "Un produit avec ce SKU existe déjà."
      });
    }

    const product = await createProduct({
      name: req.body.name.trim(),
      category: req.body.category?.trim(),
      sku: req.body.sku.trim(),
      barcode: req.body.barcode?.trim(),
      unit: req.body.unit?.trim(),
      cost_price: Number(req.body.cost_price ?? 0),
      selling_price: Number(req.body.selling_price ?? 0),
      alert_threshold: Number(req.body.alert_threshold ?? 0),
      is_active:
        req.body.is_active === undefined ? true : Boolean(req.body.is_active),
      description: req.body.description?.trim(),
      sales_account_id:
        req.body.sales_account_id === undefined ||
        req.body.sales_account_id === null ||
        req.body.sales_account_id === ""
          ? null
          : Number(req.body.sales_account_id)
    });

    return res.status(201).json({
      success: true,
      message: "Produit créé avec succès.",
      data: product
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllProductsHandler(req, res, next) {
  try {
    const products = await getAllProducts();

    return res.status(200).json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID produit invalide."
      });
    }

    const product = await getProductById(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: product
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProductHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID produit invalide."
      });
    }

    const existingProduct = await getProductById(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable."
      });
    }

    const mergedPayload = {
      ...existingProduct,
      ...req.body
    };

    const errors = validateProductPayload(mergedPayload);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    if (req.body.sku && req.body.sku.trim() !== existingProduct.sku) {
      const productWithSameSku = await getProductBySku(req.body.sku.trim());
      if (productWithSameSku) {
        return res.status(409).json({
          success: false,
          message: "Un autre produit avec ce SKU existe déjà."
        });
      }
    }

    const updatedProduct = await updateProduct(id, {
      name: String(mergedPayload.name).trim(),
      category: mergedPayload.category?.trim(),
      sku: String(mergedPayload.sku).trim(),
      barcode: mergedPayload.barcode?.trim(),
      unit: mergedPayload.unit?.trim(),
      cost_price: Number(mergedPayload.cost_price ?? 0),
      selling_price: Number(mergedPayload.selling_price ?? 0),
      alert_threshold: Number(mergedPayload.alert_threshold ?? 0),
      is_active:
        mergedPayload.is_active === undefined
          ? true
          : Boolean(mergedPayload.is_active),
      description: mergedPayload.description?.trim(),
      sales_account_id:
        mergedPayload.sales_account_id === undefined ||
        mergedPayload.sales_account_id === null ||
        mergedPayload.sales_account_id === ""
          ? null
          : Number(mergedPayload.sales_account_id)
    });

    return res.status(200).json({
      success: true,
      message: "Produit mis à jour avec succès.",
      data: updatedProduct
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteProductHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID produit invalide."
      });
    }

    const deletedProduct = await deleteProduct(id);

    if (!deletedProduct) {
      return res.status(404).json({
        success: false,
        message: "Produit introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Produit supprimé avec succès.",
      data: deletedProduct
    });
  } catch (error) {
    next(error);
  }
}