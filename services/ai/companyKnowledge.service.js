import { pool } from "../../config/db.js";

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

export async function getActiveCompanyKnowledge({
  categories = [],
  limit = 100
} = {}) {
  const values = [];
  const conditions = [`is_active = TRUE`];
  let index = 1;

  if (Array.isArray(categories) && categories.length > 0) {
    conditions.push(`category = ANY($${index})`);
    values.push(categories);
    index += 1;
  }

  values.push(limit);

  const query = `
    SELECT
      id,
      knowledge_key,
      title,
      category,
      content,
      tags,
      source_type,
      source_reference,
      priority_level,
      is_active,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM company_knowledge
    WHERE ${conditions.join(" AND ")}
    ORDER BY
      CASE priority_level
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'normal' THEN 3
        ELSE 4
      END,
      updated_at DESC
    LIMIT $${index};
  `;

  const result = await pool.query(query, values);
  return result.rows;
}

export async function getCompanyKnowledgeByKey(knowledgeKey) {
  const query = `
    SELECT
      id,
      knowledge_key,
      title,
      category,
      content,
      tags,
      source_type,
      source_reference,
      priority_level,
      is_active,
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM company_knowledge
    WHERE knowledge_key = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [knowledgeKey]);
  return result.rows[0] || null;
}

export async function upsertCompanyKnowledge({
  knowledge_key,
  title,
  category,
  content,
  tags = [],
  source_type = "manual",
  source_reference = null,
  priority_level = "normal",
  user_id = null
}) {
  const normalizedKey = String(knowledge_key || "").trim();
  const normalizedTitle = String(title || "").trim();
  const normalizedCategory = String(category || "").trim();
  const normalizedContent = String(content || "").trim();

  if (!normalizedKey) {
    throw new Error("knowledge_key est obligatoire.");
  }

  if (!normalizedTitle) {
    throw new Error("title est obligatoire.");
  }

  if (!normalizedCategory) {
    throw new Error("category est obligatoire.");
  }

  if (!normalizedContent) {
    throw new Error("content est obligatoire.");
  }

  const normalizedTags = normalizeTags(tags);

  const query = `
    INSERT INTO company_knowledge (
      knowledge_key,
      title,
      category,
      content,
      tags,
      source_type,
      source_reference,
      priority_level,
      is_active,
      created_by,
      updated_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)
    ON CONFLICT (knowledge_key)
    DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      content = EXCLUDED.content,
      tags = EXCLUDED.tags,
      source_type = EXCLUDED.source_type,
      source_reference = EXCLUDED.source_reference,
      priority_level = EXCLUDED.priority_level,
      is_active = TRUE,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING *;
  `;

  const values = [
    normalizedKey,
    normalizedTitle,
    normalizedCategory,
    normalizedContent,
    normalizedTags,
    source_type,
    source_reference,
    priority_level,
    user_id,
    user_id
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

export async function deactivateCompanyKnowledge(knowledgeKey, userId = null) {
  const query = `
    UPDATE company_knowledge
    SET
      is_active = FALSE,
      updated_by = $2,
      updated_at = NOW()
    WHERE knowledge_key = $1
    RETURNING *;
  `;

  const result = await pool.query(query, [knowledgeKey, userId]);
  return result.rows[0] || null;
}

export async function searchCompanyKnowledge(searchTerm, limit = 20) {
  const keyword = String(searchTerm || "").trim();

  if (!keyword) {
    return [];
  }

  const query = `
    SELECT
      id,
      knowledge_key,
      title,
      category,
      content,
      tags,
      source_type,
      source_reference,
      priority_level,
      updated_at
    FROM company_knowledge
    WHERE is_active = TRUE
      AND (
        title ILIKE $1
        OR content ILIKE $1
        OR category ILIKE $1
      )
    ORDER BY updated_at DESC
    LIMIT $2;
  `;

  const result = await pool.query(query, [`%${keyword}%`, limit]);
  return result.rows;
}

export async function seedDefaultCompanyKnowledge() {
  const defaults = [
    {
      knowledge_key: "company_overview",
      title: "Présentation synthétique KIVU AGRO BIO",
      category: "company_profile",
      content:
        "KIVU AGRO BIO est une entreprise congolaise spécialisée dans les produits naturels de santé, superaliments, huiles végétales, tisanes et cosmétique bio. L’entreprise est présente dans plusieurs villes de RDC et développe un réseau de distribution via supermarchés, pharmacies et canaux digitaux.",
      tags: ["company", "overview", "positioning"],
      source_type: "manual",
      source_reference: "internal",
      priority_level: "high"
    },
    {
      knowledge_key: "strategic_focus",
      title: "Axes stratégiques prioritaires",
      category: "strategy",
      content:
        "Priorités de développement : croissance du réseau de distribution, amélioration des marges, suivi de la trésorerie, pilotage stock multi-dépôts, export régional, et usage de l’intelligence artificielle pour l’analyse décisionnelle.",
      tags: ["strategy", "growth", "erp", "ai"],
      source_type: "manual",
      source_reference: "internal",
      priority_level: "high"
    }
  ];

  for (const item of defaults) {
    await upsertCompanyKnowledge(item);
  }
}