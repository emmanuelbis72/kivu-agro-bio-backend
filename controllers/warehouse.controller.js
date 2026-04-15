import {
  createWarehouse,
  getAllWarehouses,
  getWarehouseById,
  updateWarehouse,
  deleteWarehouse
} from "../models/warehouse.model.js";

function validateWarehousePayload(body) {
  const errors = [];

  if (!body.name || String(body.name).trim() === "") {
    errors.push("Le champ 'name' est obligatoire.");
  }

  if (!body.city || String(body.city).trim() === "") {
    errors.push("Le champ 'city' est obligatoire.");
  }

  return errors;
}

export async function createWarehouseHandler(req, res, next) {
  try {
    const errors = validateWarehousePayload(req.body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const warehouse = await createWarehouse({
      name: req.body.name.trim(),
      city: req.body.city.trim(),
      address: req.body.address?.trim(),
      manager_name: req.body.manager_name?.trim(),
      phone: req.body.phone?.trim()
    });

    return res.status(201).json({
      success: true,
      message: "Dépôt créé avec succès.",
      data: warehouse
    });
  } catch (error) {
    next(error);
  }
}

export async function getAllWarehousesHandler(req, res, next) {
  try {
    const warehouses = await getAllWarehouses();

    return res.status(200).json({
      success: true,
      count: warehouses.length,
      data: warehouses
    });
  } catch (error) {
    next(error);
  }
}

export async function getWarehouseByIdHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépôt invalide."
      });
    }

    const warehouse = await getWarehouseById(id);

    if (!warehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      data: warehouse
    });
  } catch (error) {
    next(error);
  }
}

export async function updateWarehouseHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépôt invalide."
      });
    }

    const existingWarehouse = await getWarehouseById(id);

    if (!existingWarehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt introuvable."
      });
    }

    const mergedPayload = {
      ...existingWarehouse,
      ...req.body
    };

    const errors = validateWarehousePayload(mergedPayload);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation échouée.",
        errors
      });
    }

    const updatedWarehouse = await updateWarehouse(id, {
      name: String(mergedPayload.name).trim(),
      city: String(mergedPayload.city).trim(),
      address: mergedPayload.address?.trim(),
      manager_name: mergedPayload.manager_name?.trim(),
      phone: mergedPayload.phone?.trim()
    });

    return res.status(200).json({
      success: true,
      message: "Dépôt mis à jour avec succès.",
      data: updatedWarehouse
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteWarehouseHandler(req, res, next) {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "ID dépôt invalide."
      });
    }

    const deletedWarehouse = await deleteWarehouse(id);

    if (!deletedWarehouse) {
      return res.status(404).json({
        success: false,
        message: "Dépôt introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Dépôt supprimé avec succès.",
      data: deletedWarehouse
    });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({
        success: false,
        message: "Impossible de supprimer ce dépôt car il est lié à du stock ou à d'autres opérations."
      });
    }

    next(error);
  }
}