import { getKabotAlerts } from "../services/ai/kabotAlerts.service.js";
import {
  getCustomerRiskScoring,
  getProductIntelligenceScoring
} from "../services/ai/kabotScoring.service.js";

export async function getKabotAlertsHandler(req, res, next) {
  try {
    const result = await getKabotAlerts();

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getKabotCustomerScoringHandler(req, res, next) {
  try {
    const rows = await getCustomerRiskScoring();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function getKabotProductScoringHandler(req, res, next) {
  try {
    const rows = await getProductIntelligenceScoring();

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}