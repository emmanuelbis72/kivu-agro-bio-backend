import { getAIScoringSummary } from "../services/ai/scoringSummary.service.js";
import { getProductScores } from "../services/ai/productScoring.service.js";
import { getCustomerScores } from "../services/ai/customerScoring.service.js";
import { getCashScore } from "../services/ai/cashScoring.service.js";
import { getBusinessRulesMap } from "../services/ai/businessRules.service.js";

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
    const businessRules = await getBusinessRulesMap();
    const data = await getCustomerScores(businessRules);

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