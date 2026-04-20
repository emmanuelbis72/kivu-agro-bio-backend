import {
  askAIQuestion,
  getQuickQuestions,
  getAIHistory
} from "../services/ai/aiOrchestrator.service.js";

import {
  getBusinessRulesMap,
  saveBusinessRule,
  validateBusinessRuleValue
} from "../services/ai/businessRules.service.js";

// 🔥 NOUVEAU IMPORT CEO
import { getCEOBRIEF } from "../services/ai/ceoReasoning.service.js";

/* ================= IA CHAT ================= */

export async function askAIHandler(req, res, next) {
  try {
    const question = String(req.body?.question || "").trim();
    const context =
      req.body?.context && typeof req.body.context === "object"
        ? req.body.context
        : {};

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'question' est obligatoire."
      });
    }

    const result = await askAIQuestion({
      question,
      context
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuickQuestionsHandler(req, res, next) {
  try {
    const questions = getQuickQuestions();

    return res.status(200).json({
      success: true,
      count: questions.length,
      data: questions
    });
  } catch (error) {
    next(error);
  }
}

export async function getAIHistoryHandler(req, res, next) {
  try {
    const history = getAIHistory();

    return res.status(200).json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (error) {
    next(error);
  }
}

/* ================= CEO REASONING ================= */

export async function getCEOBRIEFHandler(req, res, next) {
  try {
    const result = await getCEOBRIEF();

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/* ================= BUSINESS RULES ================= */

export async function getBusinessRulesHandler(req, res, next) {
  try {
    const rules = await getBusinessRulesMap();

    return res.status(200).json({
      success: true,
      data: rules
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBusinessRuleHandler(req, res, next) {
  try {
    const ruleKey = String(req.params.ruleKey || "").trim();

    if (!ruleKey) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'ruleKey' est obligatoire."
      });
    }

    if (req.body?.rule_value === undefined) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'rule_value' est obligatoire."
      });
    }

    const validation = validateBusinessRuleValue(
      ruleKey,
      req.body.rule_value
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: validation.message
      });
    }

    const savedRule = await saveBusinessRule({
      ruleKey,
      ruleValue: req.body.rule_value,
      description: req.body.description || null
    });

    return res.status(200).json({
      success: true,
      message: "Règle mise à jour avec succès",
      data: savedRule
    });
  } catch (error) {
    next(error);
  }
}