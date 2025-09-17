// src/ai/gemini.ts
import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Route via Gemini (model = GEMINI_MODEL, défaut gemini-1.5-pro)
 * -> renvoie une intention ("top_cta" | "cta_timeseries" | "recommend" | "questions_top") + params.
 * NEW: accepte un DomainPack optionnel pour contextualiser l'interprétation.
 */

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";

let cachedModel: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null = null;

function requireModel() {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY in .env (clé API Gemini).");
  }
  if (!cachedModel) {
    const genai = new GoogleGenerativeAI(GEMINI_API_KEY);
    cachedModel = genai.getGenerativeModel({ model: GEMINI_MODEL });
  }
  return cachedModel;
}

type IntentTopCta = {
  intent: "top_cta";
  params: {
    query: string;
    days?: number;
    event?: string;
    property?: string;
  };
};

type IntentTimeseries = {
  intent: "cta_timeseries";
  params: {
    query: string;
    days?: number;
    event?: string;
    property?: string;
    granularity?: "day" | "week" | "month";
    top?: number;
    values?: string[];
  };
};

type IntentRecommend = {
  intent: "recommend";
  params: {
    query: string;
    filters?: Record<string, string[]>;
    budget_eur?: number | null;
  };
};

type IntentQuestionsTop = {
  intent: "questions_top";
  params: {
    query: string;
    days?: number;       // ex: 7, 30
    top?: number;        // ex: 5, 10
    event?: string;      // défaut "User Question"
    property?: string;   // défaut "question"
  };
};

export type GeminiRouting =
  | (IntentTopCta & { source: "gemini" })
  | (IntentTimeseries & { source: "gemini" })
  | (IntentRecommend & { source: "gemini" })
  | (IntentQuestionsTop & { source: "gemini" });

/** DomainPack tolérant (partiel) */
type DomainPackLike = {
  domain?: string;
  language?: string;
  intents?: Record<string, unknown>;
  synonyms?: Record<string, string>;
  facets?: Record<
    string,
    { description?: string; values?: string[]; valueSynonyms?: Record<string, string> }
  >;
  patterns?: Record<string, string>;
  meta?: Record<string, unknown>;
};

/** Utilitaire: tronque une chaîne pour limiter la taille du prompt. */
function truncate(s: string, max = 8000) {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max) + "\n/*…truncated…*/";
}

/**
 * Appelle Gemini et renvoie un objet JSON STRICT.
 * Tolère les fences ```json et découpe entre { ... } si besoin.
 */
export async function routeWithGemini(
  question: string,
  domainPack?: DomainPackLike
): Promise<GeminiRouting> {
  const model = requireModel();
  const langNote = domainPack?.language ? `Langue de l'utilisateur: ${domainPack.language}\n` : "";
  const packSnippet = domainPack
    ? `Contexte domaine (JSON compact; facettes/synonymes/patterns utiles):
${truncate(JSON.stringify(domainPack))}`
    : "Aucun pack domaine fourni.";

  const prompt = `
Tu es un routeur d'intentions pour Graffiti (analytics + recommandations produit).
Réponds UNIQUEMENT en JSON valide, sans texte autour.

Intentions supportées:
- "top_cta"         -> meilleure valeur d'une propriété sur une période (analytics)
- "cta_timeseries"  -> série temporelle (jour/semaine/mois) (analytics)
- "recommend"       -> conseil produit (ex: “un rouge léger autour de 15€”)
- "questions_top"   -> top des questions/intentions posées par les utilisateurs

Par défaut (analytics si applicable):
- "event": "User Authenticated"
- "property": "appClipParameterR"
- "days": 30
- "granularity": "day"
- "top": 5

Règles analytics:
- “hier” -> days = 1
- “semaine dernière”/“dernière semaine” -> days = 7
- “mois dernier” -> days = 30
- “évolution/tendance/over time” -> "cta_timeseries"
- “meilleurs/top” -> "top_cta"
- “comparer cta01 et cta02” -> "cta_timeseries" + params.values=["cta01","cta02"]
- “top N” -> extraire N dans params.top

Règles recommend:
- Utiliser le domain pack (facets + valueSynonyms + synonyms) pour extraire des filtres.
- Si un budget explicite (ex: "15€"), l'extraire -> params.budget_eur (nombre, en euros).
- Ne rien inventer: si pas de budget clair, mettre null ou omettre le champ.
- Exemple de filters: {"color":["rouge"], "taste_profile":["leger","fruite"], "label":["bio"]}

Règles questions_top:
- Détecter des formulations comme:
  “qu’est-ce que demandent le plus les clients ?”,
  “top des questions posées”,
  “les requêtes les plus fréquentes”,
  “quels thèmes reviennent le plus ?”.
- Par défaut: event="User Question", property="question", days=30, top=10.
- Extraire days/top si précisés (ex: “sur 7 jours”, “top 5”).
- Ne pas inventer d’autres paramètres.

${langNote}${packSnippet}

Schémas EXACTS:

Pour "top_cta":
{
  "intent": "top_cta",
  "params": {
    "query": "<copie la question telle quelle>",
    "days": <number>,
    "event": "<string>",
    "property": "<string>"
  },
  "source": "gemini"
}

Pour "cta_timeseries":
{
  "intent": "cta_timeseries",
  "params": {
    "query": "<copie la question telle quelle>",
    "days": <number>,
    "event": "<string>",
    "property": "<string>",
    "granularity": "day" | "week" | "month",
    "top": <number>,
    "values": ["<string>", "..."]
  },
  "source": "gemini"
}

Pour "recommend":
{
  "intent": "recommend",
  "params": {
    "query": "<copie la question telle quelle>",
    "filters": { "<facet>": ["<value>", "..."] },
    "budget_eur": <number | null>
  },
  "source": "gemini"
}

Pour "questions_top":
{
  "intent": "questions_top",
  "params": {
    "query": "<copie la question telle quelle>",
    "days": <number>,
    "top": <number>,
    "event": "<string>",
    "property": "<string>"
  },
  "source": "gemini"
}

Question:
${question}
`.trim();

  const resp = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const raw = (resp.response?.text?.() ?? "").trim();

  // Extraction JSON tolérante
  let candidate = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    candidate = fence[1].trim();
  } else {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      candidate = raw.slice(start, end + 1).trim();
    }
  }

  // Parse
  let obj: any;
  try {
    obj = JSON.parse(candidate);
  } catch (e) {
    throw new Error("Failed to parse Gemini JSON. Raw response:\n" + raw);
  }

  // Validation
  const validIntent =
    obj &&
    (obj.intent === "top_cta" ||
     obj.intent === "cta_timeseries" ||
     obj.intent === "recommend" ||
     obj.intent === "questions_top");
  if (validIntent && obj.params) {
    if (!obj.source) obj.source = "gemini";
    return obj as GeminiRouting;
  }

  throw new Error("Gemini JSON has unexpected shape. Raw response:\n" + raw);
}

export default { routeWithGemini };