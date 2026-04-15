import fetch from "node-fetch";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

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

function normalizeReasoningPayload(payload, rawText = "") {
  return {
    summary:
      typeof payload?.summary === "string"
        ? payload.summary.trim()
        : "Analyse stratégique générée.",
    analysis:
      typeof payload?.analysis === "string"
        ? payload.analysis.trim()
        : rawText || "Aucune analyse détaillée renvoyée.",
    risks: Array.isArray(payload?.risks)
      ? payload.risks.map((item) => String(item).trim()).filter(Boolean)
      : [],
    opportunities: Array.isArray(payload?.opportunities)
      ? payload.opportunities.map((item) => String(item).trim()).filter(Boolean)
      : [],
    recommendations: Array.isArray(payload?.recommendations)
      ? payload.recommendations
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [],
    priority_level: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(
      String(payload?.priority_level || "").toUpperCase()
    )
      ? String(payload.priority_level).toUpperCase()
      : "MEDIUM"
  };
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
      priority_level: "MEDIUM"
    },
    cleaned
  );
}

function buildPrompt({ question, businessRules, contextData }) {
  return `
Tu es KABOT, une intelligence artificielle de direction pour KIVU AGRO BIO.

MISSION
Tu raisonnes comme un CEO, un CFO, un contrôleur de gestion et un directeur commercial.
Tu analyses l'entreprise avec réalisme, sans flatterie inutile.

RÈGLES MÉTIER KIVU AGRO BIO
${JSON.stringify(businessRules, null, 2)}

DONNÉES ACTUELLES
${JSON.stringify(contextData, null, 2)}

QUESTION UTILISATEUR
${question}

INSTRUCTIONS STRICTES
- Base-toi uniquement sur les données et règles fournies.
- Ne suppose pas de chiffres absents.
- S'il manque des données, dis-le clairement.
- Explique les causes probables avec logique métier.
- Priorise les actions.
- Donne des recommandations concrètes, actionnables et courtes.
- Réponds comme un dirigeant expérimenté.
- Retourne UNIQUEMENT un JSON valide.

FORMAT JSON OBLIGATOIRE
{
  "summary": "résumé exécutif bref",
  "analysis": "analyse détaillée et stratégique",
  "risks": ["risque 1", "risque 2"],
  "opportunities": ["opportunité 1", "opportunité 2"],
  "recommendations": ["action 1", "action 2", "action 3"],
  "priority_level": "LOW | MEDIUM | HIGH | CRITICAL"
}
`.trim();
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
    const response = await fetch(DEEPSEEK_API_URL, {
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
        response_format: { type: "json_object" }
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

    const content = data?.choices?.[0]?.message?.content;

    if (!content || typeof content !== "string") {
      throw new Error("DeepSeek API returned empty content.");
    }

    return safeParseReasoningContent(content);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runDeepseekReasoning({
  question,
  businessRules,
  contextData
}) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY manquant.");
  }

  const model = String(
    process.env.DEEPSEEK_REASONING_MODEL || "deepseek-reasoner"
  ).trim();

  const timeoutMs = getEnvNumber("DEEPSEEK_TIMEOUT_MS", 45000);
  const maxRetries = getEnvNumber("DEEPSEEK_MAX_RETRIES", 2);
  const retryDelayMs = getEnvNumber("DEEPSEEK_RETRY_DELAY_MS", 1500);
  const maxTokens = getEnvNumber("DEEPSEEK_MAX_TOKENS", 1800);
  const temperature = getEnvNumber("DEEPSEEK_TEMPERATURE", 0.2);
  const debug = getEnvBoolean("DEEPSEEK_DEBUG", false);

  const prompt = buildPrompt({
    question,
    businessRules,
    contextData
  });

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      if (debug) {
        console.log(
          `[DeepSeek] Attempt ${attempt}/${maxRetries + 1} with model=${model}`
        );
      }

      const result = await callDeepSeekOnce({
        apiKey,
        model,
        temperature,
        maxTokens,
        timeoutMs,
        prompt
      });

      return result;
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