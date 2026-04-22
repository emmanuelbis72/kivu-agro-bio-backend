import { getAIScoringSummary } from "../services/ai/scoringSummary.service.js";
import { getProductScores } from "../services/ai/productScoring.service.js";
import { getCashScore } from "../services/ai/cashScoring.service.js";
import { getBusinessRulesMap } from "../services/ai/businessRules.service.js";
import {
  getLatestPersistedCustomerScores,
  syncCustomerScoresSnapshot
} from "../services/ai/customerScorePersistence.service.js";

export async function getAIScoringSummaryHandler(req, res, next) {
  try {
    const data = await getAIScoringSummary();

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductScoresHandler(req, res, next) {
  try {
    const businessRules = await getBusinessRulesMap();
    const data = await getProductScores(businessRules);

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getCustomerScoresHandler(req, res, next) {
  try {
    const sync =
      String(req.query?.sync ?? "true").trim().toLowerCase() !== "false";

    let data = [];

    if (sync) {
      data = await syncCustomerScoresSnapshot();
    } else {
      data = await getLatestPersistedCustomerScores(100);
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getCashScoreHandler(req, res, next) {
  try {
    const businessRules = await getBusinessRulesMap();
    const data = await getCashScore(businessRules);

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function syncCustomerScoresHandler(req, res, next) {
  try {
    const data = await syncCustomerScoresSnapshot();

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}
