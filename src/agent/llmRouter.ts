// src/agent/llmRouter.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { routeQuery, RoutedIntent } from "./router";

// --- Schéma strict de sortie attendu du LLM -------------------------------
const TopSchema = z.object({
  intent: z.literal("top_cta"),
  params: z.object({
    query: z.string().optional(),
    days: z.number().int().positive().optional(),
    event: z.string().optional(),
    property: z.string().optional(),
  }),
});

const TimeseriesSchema = z.object({
  intent: z.literal("cta_timeseries"),
  params: z.object({
    query: z.string().optional(),
    days: z.number().int().positive().optional(),
    event: z.string().optional(),
    property: z.string().optional(),
    granularity: z.enum(["day", "week", "month"]).optional(),
    top: z.number().int().positive().max(50).optional(),
  }),
});

const LlmOutputSchema = z.union([TopSchema, TimeseriesSchema]);

// --- Types du meta renvoyé au dessus du RoutedIntent ----------------------
type Meta = {
  source: "gemini" | "regex_fallback";
  model?: string;
  reason?: string;
};

// --- Utilitaire pour extraire du JSON même si le LLM met des ```json ------
function extractJson(s: string): any {
  const trimmed = s.trim();
  // bloc ```json ... ```
  const fence = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1] : trimmed;
  return JSON.parse(jsonText);
}

// --- Prompt minimaliste, contraint ----------------------------------------
function buildPrompt(question: string) {
  return [
    {
      role: "user",
      parts: [
        {
          text:
            `Tu es un routeur NL->JSON. Réponds UNIQUEMENT en JSON valide **sans commentaire**.\n\n` +
            `Tu dois retourner exactement UNE de ces formes:\n\n` +
            `1) {"intent":"top_cta","params":{"days":<number>,"event":"User Authenticated","property":"appClipParameterR"}}\n` +
            `2) {"intent":"cta_timeseries","params":{"days":<number>,"event":"User Authenticated","property":"appClipParameterR","granularity":"day|week|month","top":<number>}}\n\n` +
            `Règles:\n` +
            `- Par défaut, days=30, event="User Authenticated", property="appClipParameterR", granularity="day", top=5.\n` +
            `- "hier" => days=1.\n` +
            `- "semaine" => granularity="week" (days si mentionné).\n` +
            `- "mois" => granularity="month".\n` +
            `- N'invente pas d'autres intents.\n` +
            `- Réponds en JSON strict (aucun texte autour).\n\n` +
            `Question: ${question}`,
        },
      ],
    },
  ];
}

// --- Routeur principal -----------------------------------------------------
export async function llmRoute(question: string): Promise<{ routed: RoutedIntent; meta: Meta }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  // Pas de clé => fallback direct
  if (!apiKey) {
    return {
      routed: routeQuery(question),
      meta: { source: "regex_fallback", reason: "GEMINI_API_KEY missing" },
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent({ contents: buildPrompt(question) });
    const text = result.response.text();

    const parsed = extractJson(text);
    const validated = LlmOutputSchema.parse(parsed);

    // Normalisation vers RoutedIntent (on conserve seulement ce qui est utile)
    const routed: RoutedIntent =
      validated.intent === "top_cta"
        ? {
            intent: "top_cta",
            params: {
              query: question,
              days: validated.params.days,
              event: validated.params.event,
              property: validated.params.property,
            },
          }
        : {
            intent: "cta_timeseries",
            params: {
              query: question,
              days: validated.params.days,
              event: validated.params.event,
              property: validated.params.property,
              granularity: validated.params.granularity,
              top: validated.params.top,
            },
          };

    return { routed, meta: { source: "gemini", model: modelName } };
  } catch (err: any) {
    // En cas d'échec de Gemini (erreur réseau, JSON invalide, Zod…), on retombe sur le router regex.
    return {
      routed: routeQuery(question),
      meta: {
        source: "regex_fallback",
        reason: String(err?.message || err || "Unknown Gemini error"),
      },
    };
  }
}

export default { llmRoute };