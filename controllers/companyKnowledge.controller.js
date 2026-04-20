import {
  getActiveCompanyKnowledge,
  getCompanyKnowledgeByKey,
  upsertCompanyKnowledge,
  deactivateCompanyKnowledge,
  searchCompanyKnowledge,
  seedDefaultCompanyKnowledge
} from "../services/ai/companyKnowledge.service.js";

function parsePositiveLimit(value, defaultValue = 50, maxValue = 500) {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

function normalizeCategories(rawValue) {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(rawValue)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTags(rawValue) {
  if (!rawValue) {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(rawValue)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getCompanyKnowledgeListHandler(req, res, next) {
  try {
    const categories = normalizeCategories(req.query.categories);
    const limit = parsePositiveLimit(req.query.limit, 100, 500);

    const rows = await getActiveCompanyKnowledge({
      categories,
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

export async function getCompanyKnowledgeByKeyHandler(req, res, next) {
  try {
    const knowledgeKey = String(req.params.knowledgeKey || "").trim();

    if (!knowledgeKey) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'knowledgeKey' est obligatoire."
      });
    }

    const row = await getCompanyKnowledgeByKey(knowledgeKey);

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Aucune connaissance trouvée pour cette clé."
      });
    }

    return res.status(200).json({
      success: true,
      data: row
    });
  } catch (error) {
    next(error);
  }
}

export async function upsertCompanyKnowledgeHandler(req, res, next) {
  try {
    const knowledge_key = String(req.body?.knowledge_key || "").trim();
    const title = String(req.body?.title || "").trim();
    const category = String(req.body?.category || "").trim();
    const content = String(req.body?.content || "").trim();

    if (!knowledge_key) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'knowledge_key' est obligatoire."
      });
    }

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'title' est obligatoire."
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'category' est obligatoire."
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Le champ 'content' est obligatoire."
      });
    }

    const saved = await upsertCompanyKnowledge({
      knowledge_key,
      title,
      category,
      content,
      tags: normalizeTags(req.body?.tags),
      source_type: req.body?.source_type || "manual",
      source_reference: req.body?.source_reference || null,
      priority_level: req.body?.priority_level || "normal",
      user_id: req.user?.id || null
    });

    return res.status(200).json({
      success: true,
      message: "Connaissance entreprise enregistrée avec succès.",
      data: saved
    });
  } catch (error) {
    next(error);
  }
}

export async function deactivateCompanyKnowledgeHandler(req, res, next) {
  try {
    const knowledgeKey = String(req.params.knowledgeKey || "").trim();

    if (!knowledgeKey) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'knowledgeKey' est obligatoire."
      });
    }

    const row = await deactivateCompanyKnowledge(
      knowledgeKey,
      req.user?.id || null
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Aucune connaissance trouvée pour cette clé."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Connaissance désactivée avec succès.",
      data: row
    });
  } catch (error) {
    next(error);
  }
}

export async function searchCompanyKnowledgeHandler(req, res, next) {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Le paramètre 'q' est obligatoire."
      });
    }

    const limit = parsePositiveLimit(req.query.limit, 20, 100);
    const rows = await searchCompanyKnowledge(q, limit);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

export async function seedCompanyKnowledgeHandler(req, res, next) {
  try {
    await seedDefaultCompanyKnowledge();

    return res.status(200).json({
      success: true,
      message: "Mémoire entreprise initialisée avec succès."
    });
  } catch (error) {
    next(error);
  }
}