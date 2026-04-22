import fetch from "node-fetch";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnvNumber(name, fallback) {
  const raw = process.env[name];
  const value = Number(raw);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getEnvBoolean(name, fallback = false) {
  const raw = String(process.env[name] || "").trim().toLowerCase();

  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function getDeepSeekApiUrl() {
  const baseUrl = String(
    process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
  )
    .trim()
    .replace(/\/+$/, "");

  return `${baseUrl}/chat/completions`;
}

function cleanMarkdownFences(text) {
  if (!text) return "";

  return String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text) {
  const input = cleanMarkdownFences(text);

  const firstBrace = input.indexOf("{");
  const lastBrace = input.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return input.slice(firstBrace, lastBrace + 1);
}

function normalizePriorityLevel(value) {
  const normalized = String(value || "").trim().toUpperCase();

  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(normalized)) {
    return normalized;
  }

  return "MEDIUM";
}

function normalizeConfidenceScore(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0.85;
  }

  if (numeric < 0) return 0;
  if (numeric > 1) return 1;

  return Math.round(numeric * 100) / 100;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTextBlock(value, fallback = "") {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  return fallback;
}

function normalizeReasoningPayload(payload, rawText = "") {
  const recommendations = normalizeStringArray(payload?.recommendations);
  const actions = normalizeStringArray(payload?.actions);
  const alerts = normalizeStringArray(payload?.alerts);
  const summary = normalizeTextBlock(
    payload?.summary,
    "Analyse stratégique générée."
  );
  const analysis = normalizeTextBlock(
    payload?.analysis,
    rawText || "Aucune analyse détaillée renvoyée."
  );

  return {
    summary,
    analysis,
    risks:
      normalizeStringArray(payload?.risks).length > 0
        ? normalizeStringArray(payload?.risks)
        : alerts,
    opportunities: normalizeStringArray(payload?.opportunities),
    recommendations,
    actions: actions.length > 0 ? actions : recommendations,
    priority_level: normalizePriorityLevel(payload?.priority_level),
    confidence_score: normalizeConfidenceScore(payload?.confidence_score),
    metrics:
      payload?.metrics &&
      typeof payload.metrics === "object" &&
      !Array.isArray(payload.metrics)
        ? payload.metrics
        : {}
  };
}

function isWeakReasoningPayload(payload) {
  const summary = String(payload?.summary || "").trim();
  const analysis = String(payload?.analysis || "").trim();
  const recommendations = Array.isArray(payload?.recommendations)
    ? payload.recommendations.length
    : 0;
  const actions = Array.isArray(payload?.actions) ? payload.actions.length : 0;

  return (
    !summary ||
    summary === "Analyse stratégique générée." ||
    !analysis ||
    analysis.startsWith("{") ||
    (recommendations === 0 && actions === 0)
  );
}

function safeParseReasoningContent(content) {
  const cleaned = cleanMarkdownFences(content);

  try {
    const parsed = JSON.parse(cleaned);
    return normalizeReasoningPayload(parsed, cleaned);
  } catch (_) {
    // continue
  }

  const extracted = extractFirstJsonObject(cleaned);

  if (extracted) {
    try {
      const parsed = JSON.parse(extracted);
      return normalizeReasoningPayload(parsed, cleaned);
    } catch (_) {
      // continue
    }
  }

  return normalizeReasoningPayload(
    {
      summary: "Analyse stratégique générée.",
      analysis: cleaned,
      risks: [],
      opportunities: [],
      recommendations: [],
      actions: [],
      priority_level: "MEDIUM",
      confidence_score: 0.7
    },
    cleaned
  );
}

function buildAssistantPrompt({ question, businessRules, contextData }) {
  const focus = String(contextData?.focus || "general").trim().toLowerCase();
  const extraInstructions =
    focus === "accounting"
      ? [
          "Instructions specifiques comptabilite:",
          "- Lis les donnees comme un directeur financier.",
          "- Donne un resume de reporting comptable exploitable en comite de direction.",
          "- Commente le resultat, l'equilibre debit-credit, le bilan, les brouillons et les comptes dominants quand ces donnees existent.",
          "- Propose des actions concretes de cloture, controle ou pilotage comptable.",
          '- Remplis \"metrics\" avec les indicateurs comptables les plus importants disponibles.'
        ].join("\n")
      : [
          "Instructions specifiques:",
          "- Si des donnees comptables sont presentes, integre-les dans le diagnostic.",
          '- Remplis \"metrics\" avec les indicateurs les plus utiles pour la decision.'
        ].join("\n");

  return `
Tu es KABOT, copilote CEO/CFO de KIVU AGRO BIO.

Règles:
- Utilise seulement les données fournies.
- N'invente aucun chiffre.
- Si une donnée manque, dis-le clairement.
- Réponse courte, niveau direction générale.
- Priorise les risques et les actions.
- Maximum 5 éléments par tableau.
- Integre les donnees comptables et de reporting si elles sont fournies.
- Retourne uniquement un JSON valide.
- Pas de markdown.
- "summary" et "analysis" doivent être des chaînes.

Business rules:
${JSON.stringify(businessRules)}

${extraInstructions}

Contexte:
${JSON.stringify(contextData)}

Question:
${question}

JSON attendu:
{
  "summary": "texte, 3 à 5 phrases",
  "analysis": "texte concis, 1 à 3 paragraphes courts",
  "risks": ["risque 1", "risque 2"],
  "opportunities": ["opportunité 1", "opportunité 2"],
  "recommendations": ["recommandation 1", "recommandation 2"],
  "actions": ["action prioritaire 1", "action prioritaire 2", "action prioritaire 3"],
  "metrics": {
    "metric_1": 0
  },
  "priority_level": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence_score": 0.0
}
`.trim();
}

function buildCEOPrompt({ question, businessRules, contextData }) {
  return `
Tu es KABOT, assistant CEO de KIVU AGRO BIO.

Règles:
- Base-toi uniquement sur les données fournies.
- N'invente aucun chiffre.
- Si une donnée manque, dis-le clairement.
- Réponds en français professionnel, orienté décision.
- Retourne uniquement un JSON valide.

Business rules:
${JSON.stringify(businessRules)}

Contexte:
${JSON.stringify(contextData)}

Question:
${question}

JSON attendu:
{
  "summary": "résumé exécutif en 5 à 8 lignes",
  "analysis": "analyse détaillée structurée",
  "risks": ["..."],
  "opportunities": ["..."],
  "recommendations": ["..."],
  "actions": ["..."],
  "metrics": {
    "metric_1": 0
  },
  "priority_level": "LOW | MEDIUM | HIGH | CRITICAL",
  "confidence_score": 0.0
}
`.trim();
}

function buildPrompt({ question, businessRules, contextData, profile }) {
  return profile === "ceo"
    ? buildCEOPrompt({ question, businessRules, contextData })
    : buildAssistantPrompt({ question, businessRules, contextData });
}

async function callDeepSeekOnce({
  apiKey,
  model,
  temperature,
  maxTokens,
  timeoutMs,
  prompt
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const responseFormat =
      String(model).trim().toLowerCase() === "deepseek-reasoner"
        ? undefined
        : { type: "json_object" };

    const response = await fetch(getDeepSeekApiUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature,
        max_tokens: maxTokens,
        ...(responseFormat ? { response_format: responseFormat } : {})
      }),
      signal: controller.signal
    });

    const rawText = await response.text();

    if (!response.ok) {
      const error = new Error(
        `DeepSeek API error: HTTP ${response.status} - ${rawText}`
      );
      error.status = response.status;
      throw error;
    }

    let data;

    try {
      data = JSON.parse(rawText);
    } catch (parseError) {
      const error = new Error(
        `DeepSeek API returned non-JSON response: ${rawText}`
      );
      error.cause = parseError;
      throw error;
    }

    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason || null;

    if (!content || typeof content !== "string") {
      throw new Error("DeepSeek API returned empty content.");
    }

    return {
      payload: safeParseReasoningContent(content),
      finishReason
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runDeepseekReasoning({
  question,
  businessRules,
  contextData,
  profile = "assistant"
}) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY manquant.");
  }

  const model = String(
    process.env.DEEPSEEK_REASONING_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      "deepseek-reasoner"
  ).trim();

  const timeoutLimit = profile === "assistant" ? 120000 : 120000;
  const timeoutMs = Math.min(
    getEnvNumber("DEEPSEEK_TIMEOUT_MS", 90000),
    timeoutLimit
  );
  const configuredRetries = Math.min(getEnvNumber("DEEPSEEK_MAX_RETRIES", 0), 2);
  const maxRetries =
    profile === "assistant" || profile === "ceo"
      ? Math.max(1, configuredRetries)
      : configuredRetries;
  const retryDelayMs = getEnvNumber("DEEPSEEK_RETRY_DELAY_MS", 1500);
  const defaultMaxTokens = profile === "assistant" ? 700 : 1000;
  const baseMaxTokens = Math.min(
    getEnvNumber("DEEPSEEK_MAX_TOKENS", defaultMaxTokens),
    2000
  );
  const temperature = getEnvNumber("DEEPSEEK_TEMPERATURE", 0.2);
  const debug = getEnvBoolean("DEEPSEEK_DEBUG", false);

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      if (debug) {
        console.log(
          `[DeepSeek] Attempt ${attempt}/${maxRetries + 1} with model=${model}`
        );
      }

      const maxTokens =
        profile === "assistant" && attempt > 1
          ? Math.min(baseMaxTokens + 400, 2200)
          : baseMaxTokens;

      const prompt = buildPrompt({
        question,
        businessRules,
        contextData,
        profile
      });

      const result = await callDeepSeekOnce({
        apiKey,
        model,
        temperature,
        maxTokens,
        timeoutMs,
        prompt
      });

      if (
        profile === "assistant" &&
        (result.finishReason === "length" || isWeakReasoningPayload(result.payload))
      ) {
        const error = new Error("DeepSeek assistant payload incomplete.");
        error.code = "DEEPSEEK_INCOMPLETE_PAYLOAD";
        throw error;
      }

      return result.payload;
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxRetries + 1;

      if (debug) {
        console.error("[DeepSeek] Attempt failed:", {
          attempt,
          message: error.message
        });
      }

      if (isLastAttempt) {
        break;
      }

      await sleep(retryDelayMs * attempt);
    }
  }

  throw lastError || new Error("DeepSeek reasoning failed.");
}
