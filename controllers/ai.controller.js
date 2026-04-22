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
import { getCEOBRIEF } from "../services/ai/ceoReasoning.service.js";
import {
  createStoredAIRecommendation,
  decideStoredAIRecommendation,
  listPersistedAIRuns,
  listStoredAIAlerts,
  listStoredAIRecommendations,
  persistAIQuestionRun,
  resolveStoredAIAlert,
  syncKabotAlertsToStore
} from "../services/ai/aiPersistence.service.js";
import {
  listPersistedAIForecasts,
  syncAIForecasts
} from "../services/ai/forecasting.service.js";

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

    try {
      const businessRules = await getBusinessRulesMap();

      await persistAIQuestionRun({
        question,
        context,
        response: result,
        businessRules
      });
    } catch (persistError) {
      console.error("Impossible de persister le run IA :", persistError);
    }

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
    const limit = Math.min(
      100,
      Math.max(1, Number(req.query?.limit || 20) || 20)
    );

    let history = [];

    try {
      history = await listPersistedAIRuns(limit);
    } catch (dbError) {
      console.error("Lecture DB AI history impossible, fallback memoire :", dbError);
      history = getAIHistory();
    }

    return res.status(200).json({
      success: true,
      count: history.length,
      data: history
    });
  } catch (error) {
    next(error);
  }
}

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
        message: "Le parametre 'ruleKey' est obligatoire."
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
      message: "Regle mise a jour avec succes.",
      data: savedRule
    });
  } catch (error) {
    next(error);
  }
}

export async function syncAIAlertsHandler(req, res, next) {
  try {
    const result = await syncKabotAlertsToStore();

    return res.status(200).json({
      success: true,
      message: "Alertes IA synchronisees avec succes.",
      ...result
    });
  } catch (error) {
    next(error);
  }
}

export async function getAIAlertsStoreHandler(req, res, next) {
  try {
    const limit = Math.min(
      200,
      Math.max(1, Number(req.query?.limit || 50) || 50)
    );

    const data = await listStoredAIAlerts({
      domain: req.query?.domain || null,
      severity: req.query?.severity || null,
      resolution_state: req.query?.resolution_state || null,
      limit
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function resolveAIAlertHandler(req, res, next) {
  try {
    const id = Number(req.params?.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de l'alerte est invalide."
      });
    }

    const alert = await resolveStoredAIAlert(id, {
      resolved_by: req.body?.resolved_by || null,
      resolution_notes: req.body?.resolution_notes || null
    });

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Alerte IA introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Alerte IA resolue avec succes.",
      data: alert
    });
  } catch (error) {
    next(error);
  }
}

export async function getAIRecommendationsHandler(req, res, next) {
  try {
    const limit = Math.min(
      200,
      Math.max(1, Number(req.query?.limit || 50) || 50)
    );

    const data = await listStoredAIRecommendations({
      domain: req.query?.domain || null,
      decision_state: req.query?.decision_state || null,
      limit
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function createAIRecommendationHandler(req, res, next) {
  try {
    const sourceAgent = String(req.body?.source_agent || "").trim();
    const domain = String(req.body?.domain || "").trim();
    const recommendationType = String(
      req.body?.recommendation_type || ""
    ).trim();
    const title = String(req.body?.title || "").trim();
    const summary = String(req.body?.summary || "").trim();

    if (!sourceAgent || !domain || !recommendationType || !title || !summary) {
      return res.status(400).json({
        success: false,
        message:
          "Les champs source_agent, domain, recommendation_type, title et summary sont obligatoires."
      });
    }

    const data = await createStoredAIRecommendation({
      run_id: req.body?.run_id || null,
      source_agent: sourceAgent,
      domain,
      recommendation_type: recommendationType,
      title,
      summary,
      rationale: req.body?.rationale || null,
      expected_impact: req.body?.expected_impact || "medium",
      urgency: req.body?.urgency || "medium",
      confidence_score:
        req.body?.confidence_score !== undefined && req.body?.confidence_score !== null
          ? Number(req.body.confidence_score)
          : null,
      entity_type: req.body?.entity_type || null,
      entity_id: req.body?.entity_id || null,
      action_payload:
        req.body?.action_payload && typeof req.body.action_payload === "object"
          ? req.body.action_payload
          : {},
      supporting_metrics:
        req.body?.supporting_metrics &&
        typeof req.body.supporting_metrics === "object"
          ? req.body.supporting_metrics
          : {},
      approval_requirement: req.body?.approval_requirement || "approval_required"
    });

    return res.status(201).json({
      success: true,
      message: "Recommandation IA creee avec succes.",
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function decideAIRecommendationHandler(req, res, next) {
  try {
    const id = Number(req.params?.id);
    const decisionState = String(req.body?.decision_state || "").trim();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        success: false,
        message: "L'identifiant de la recommandation est invalide."
      });
    }

    if (!decisionState) {
      return res.status(400).json({
        success: false,
        message: "Le champ decision_state est obligatoire."
      });
    }

    const data = await decideStoredAIRecommendation(id, {
      decision_state: decisionState,
      decided_by: req.body?.decided_by || null,
      decision_notes: req.body?.decision_notes || null
    });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Recommandation IA introuvable."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Decision sur la recommandation enregistree avec succes.",
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function syncAIForecastsHandler(req, res, next) {
  try {
    const data = await syncAIForecasts();

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}

export async function getAIForecastsHandler(req, res, next) {
  try {
    const limit = Math.min(
      200,
      Math.max(1, Number(req.query?.limit || 50) || 50)
    );

    const data = await listPersistedAIForecasts({
      forecast_domain: req.query?.forecast_domain || null,
      scenario_label: req.query?.scenario_label || null,
      limit
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data
    });
  } catch (error) {
    next(error);
  }
}
