// src/flows/analyze-cta-performance.ts
import { defineFlow } from "@genkit-ai/flow";
import { z } from "zod";
import "dotenv/config";
import fetch from "node-fetch";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Mixpanel env ---
const MIXPANEL_PROJECT_ID = process.env.MIXPANEL_PROJECT_ID!;
const MIXPANEL_USERNAME = process.env.MIXPANEL_SERVICE_ACCOUNT!;
const MIXPANEL_SECRET = process.env.MIXPANEL_SECRET!;
if (!MIXPANEL_PROJECT_ID || !MIXPANEL_USERNAME || !MIXPANEL_SECRET) {
  throw new Error("Missing Mixpanel env (MIXPANEL_PROJECT_ID, MIXPANEL_SERVICE_ACCOUNT, MIXPANEL_SECRET).");
}
const AUTH = "Basic " + Buffer.from(`${MIXPANEL_USERNAME}:${MIXPANEL_SECRET}`).toString("base64");
const JQL_URL = `https://eu.mixpanel.com/api/2.0/jql?project_id=${MIXPANEL_PROJECT_ID}`;

// --- Gemini env (résumé naturel facultatif) ---
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-pro";
const canUseGemini = Boolean(GEMINI_API_KEY);
const genai = canUseGemini ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const geminiModel = canUseGemini ? genai!.getGenerativeModel({ model: GEMINI_MODEL }) : null;

// --- Utils ---
function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function jql(script: string, params: Record<string, unknown>) {
  const res = await fetch(JQL_URL, {
    method: "POST",
    headers: {
      Authorization: AUTH,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      script,
      params: JSON.stringify(params),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mixpanel JQL error: ${res.status} ${res.statusText} – ${text}`);
  }
  return res.json();
}

// ===== JQL compatible EU (pas de sort/orderBy/slice/toList) =====
async function topByProperty(params: {
  event: string;
  property: string;
  from: string;
  to: string;
}) {
  const { event, property, from, to } = params;

  const script = `
    function main() {
      return Events({
        from_date: params.from,
        to_date: params.to,
        event_selectors: [{ event: params.event }]
      })
      .map(function(e) {
        var v = (e.properties && e.properties[params.property]) || null;
        return { key: v, count: 1 };
      })
      .groupBy(["key"], mixpanel.reducer.sum("count"))
      .filter(function(row){ return row.key !== null && row.key !== undefined && row.key !== ""; })
      .map(function(row){ return { value: row.key[0], count: row.value }; });
    }
  `;

  const rows = await jql(script, { event, property, from, to });
  return rows as Array<{ value: string; count: number }>;
}

// --- Résumé naturel (facultatif) avec Gemini ---
async function summarizeWithGemini(args: {
  rows: Array<{ value: string; count: number }>;
  best: { value: string; count: number };
  days: number;
  event: string;
  property: string;
}): Promise<string | null> {
  if (!geminiModel) return null;

  const { rows, best, days, event, property } = args;
  const payload = {
    event,
    property,
    window_days: days,
    best,
    rows,
  };

  const prompt = `
Tu es un analyste produit. Résume en une ou deux phrases, en **français clair**, la performance des CTA ci-dessous.
Sois factuel, pas de langage marketing. Mentionne le gagnant et un écart si pertinent.
Réponds **uniquement** par du texte (pas de JSON).

Données (JSON):
${JSON.stringify(payload, null, 2)}
  `.trim();

  const resp = await geminiModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = resp.response.text().trim();
  return text || null;
}

// --- Flow ---
const analyzeCtaPerformance = defineFlow(
  {
    name: "analyzeCtaPerformance",
    inputSchema: z.object({
      query: z.string(),
      days: z.number().int().positive().optional(),
      event: z.string().optional(),
      property: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    outputSchema: z.object({
      answer: z.string(),
      summary: z.string().optional(),
      summary_source: z.enum(["gemini", "none"]).optional(),
      best: z.object({ value: z.string(), count: z.number() }).optional(),
      rows: z.array(z.object({ value: z.string(), count: z.number() })).optional(),
      used: z.object({
        event: z.string(),
        property: z.string(),
        from: z.string(),
        to: z.string(),
      }),
    }),
  },
  async (input) => {
    const days = input.days ?? 30;
    const event = input.event ?? "User Authenticated";
    const property = input.property ?? "appClipParameterR";
    const to = daysAgo(0);
    const from = daysAgo(days);
    const limit = input.limit ?? 50;

    const rowsRaw = await topByProperty({ event, property, from, to });
    const rows = rowsRaw.sort((a, b) => b.count - a.count).slice(0, limit);

    if (rows.length === 0) {
      return {
        answer: `No data for "${event}" grouped by "${property}" between ${from} and ${to}.`,
        summary_source: "none",
        rows: [],
        used: { event, property, from, to },
      };
    }

    const best = rows[0];
    // Résumé naturel (non bloquant)
    let summary: string | null = null;
    try {
      summary = await summarizeWithGemini({ rows, best, days, event, property });
    } catch {
      summary = null; // on ignore toute erreur LLM
    }

    return {
      answer: `Best ${property} is "${best.value}" with ${best.count} events (last ${days} days).`,
      summary: summary ?? undefined,
      summary_source: summary ? "gemini" : "none",
      best,
      rows,
      used: { event, property, from, to },
    };
  }
);

// --- Handler pur pour API/CLI ---
export async function analyzeCtaPerformanceHandler(input: {
  event?: string;
  property?: string;
  days?: number;
  limit?: number;
}) {
  const days = input.days ?? 30;
  const event = input.event ?? "User Authenticated";
  const property = input.property ?? "appClipParameterR";
  const to = daysAgo(0);
  const from = daysAgo(days);
  const limit = input.limit ?? 50;

  const rowsRaw = await topByProperty({ event, property, from, to });
  const rows = rowsRaw.sort((a, b) => b.count - a.count).slice(0, limit);

  if (rows.length === 0) {
    return {
      answer: `No data for "${event}" grouped by "${property}" between ${from} and ${to}.`,
      summary_source: "none",
      rows: [],
      used: { event, property, from, to },
    };
  }

  const best = rows[0];
  let summary: string | null = null;
  try {
    summary = await summarizeWithGemini({ rows, best, days, event, property });
  } catch {
    summary = null;
  }

  return {
    answer: `Best ${property} is "${best.value}" with ${best.count} events (last ${days} days).`,
    summary: summary ?? undefined,
    summary_source: summary ? "gemini" : "none",
    best,
    rows,
    used: { event, property, from, to },
  };
}

export default analyzeCtaPerformance;
export { analyzeCtaPerformance };