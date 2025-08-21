// src/agent/router.ts
//
// Very-lightweight NL router (FR/EN) -> intents for our existing flows.
// Intents supported:
//  - "top_cta"        -> analyzeCtaPerformance
//  - "cta_timeseries" -> ctaTimeseries  (peut aussi servir pour une comparaison en fixant params.values)
//
// Defaults are aligned with your current Mixpanel usage:
//   event    = "User Authenticated"
//   property = "appClipParameterR"
//   days     = 30
//   granularity (timeseries) = "day"
//
// This is deterministic (no LLM). We’ll plug a real LLM later.

export type TopCtaParams = {
  query: string;
  days?: number;
  event?: string;
  property?: string;
};

export type TimeseriesParams = {
  query: string;
  days?: number;
  event?: string;
  property?: string;
  granularity?: "day" | "week" | "month";
  top?: number;             // how many CTA values to include
  values?: string[];        // <-- explicit values for comparison, e.g. ["cta01","cta02"]
};

export type RoutedIntent =
  | { intent: "top_cta"; params: TopCtaParams }
  | { intent: "cta_timeseries"; params: TimeseriesParams }
  | { intent: "fallback"; params: { query: string } };

// --- Helpers ---------------------------------------------------------------

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function extractDays(q: string): number | undefined {
  const text = normalize(q);

  // explicit "last N days" / "sur N jours"
  const m1 = text.match(
    /(?:last|sur|sur les|durant|pendant)\s+(\d{1,3})\s*(?:j|jours|day|days)\b/
  );
  if (m1) return Number(m1[1]);

  // bare "N jours/j" or "N days"
  const m2 = text.match(/\b(\d{1,3})\s*(?:j|jours|day|days)\b/);
  if (m2) return Number(m2[1]);

  // common presets
  if (/\b7\b/.test(text) && /(j|jours|day|days)/.test(text)) return 7;
  if (/\b30\b/.test(text) && /(j|jours|day|days)/.test(text)) return 30;
  if (/\b90\b/.test(text) && /(j|jours|day|days)/.test(text)) return 90;

  // keywords
  if (/\b(semaine|week)\b/.test(text)) return 7;
  if (/\b(mois|month)\b/.test(text)) return 30;

  return undefined; // default applied later
}

function extractGranularity(q: string): "day" | "week" | "month" | undefined {
  const t = normalize(q);
  if (/\b(jour|daily|day)\b/.test(t)) return "day";
  if (/\b(semaine|hebdo|weekly|week)\b/.test(t)) return "week";
  if (/\b(mois|mensuel|monthly|month)\b/.test(t)) return "month";
  return undefined;
}

function mentionsTimeseries(q: string): boolean {
  const t = normalize(q);
  return (
    /\b(evolution|tendance|trend|over time|au fil du temps|serie temporelle|timeseries)\b/.test(t) ||
    /\b(par jour|par semaine|par mois|daily|weekly|monthly)\b/.test(t)
  );
}

function mentionsTopBest(q: string): boolean {
  const t = normalize(q);
  return (
    /\b(meilleur|meilleure|top|best|most|plus performant|performed? best)\b/.test(t) ||
    /\bclassement|ranking\b/.test(t)
  );
}

function extractTopN(q: string): number | undefined {
  const t = normalize(q);
  const m = t.match(/\btop\s*(\d{1,2})\b/); // e.g., "top 5"
  if (m) return Number(m[1]);
  return undefined;
}

// NEW: detect comparison like "compare cta01 et cta02", "cta01 vs cta02", etc.
function extractCompareValues(q: string): string[] | undefined {
  const t = normalize(q);

  // Accept a variety of separators / phrasing
  // ex: "compare cta01 et cta02", "compare cta01 avec cta02", "cta01 vs cta02", "cta01, cta02"
  const re = /\b(?:compare|comparer|comparaison)?\s*([a-z0-9_-]{3,})\s*(?:,|et|avec|vs|versus|\s)\s*([a-z0-9_-]{3,})\b/;
  const m = t.match(re);
  if (!m) return undefined;

  const a = m[1];
  const b = m[2];
  // Keep only plausible CTA tokens like cta01, cta02… but allow generic strings too
  const values = [a, b].map((v) => v.trim()).filter(Boolean);
  if (values.length === 2 && values[0] !== values[1]) return values;
  return undefined;
}

// Potential future: detect event/property from text. For now, defaults:
const DEFAULT_EVENT = "User Authenticated";
const DEFAULT_PROPERTY = "appClipParameterR";

// --- Router ---------------------------------------------------------------

export function routeQuery(query: string): RoutedIntent {
  const days = extractDays(query) ?? 30;

  // 1) Comparison first (maps to timeseries + fixed values)
  const compareValues = extractCompareValues(query);
  if (compareValues && compareValues.length === 2) {
    return {
      intent: "cta_timeseries",
      params: {
        query,
        days,
        event: DEFAULT_EVENT,
        property: DEFAULT_PROPERTY,
        granularity: extractGranularity(query) ?? "day",
        values: compareValues,   // <-- key part
      },
    };
  }

  // 2) Timeseries (trend / evolution)
  if (mentionsTimeseries(query)) {
    const gran = extractGranularity(query) ?? "day";
    const top = extractTopN(query) ?? 5;

    return {
      intent: "cta_timeseries",
      params: {
        query,
        days,
        event: DEFAULT_EVENT,
        property: DEFAULT_PROPERTY,
        granularity: gran,
        top,
      },
    };
  }

  // 3) Top/best
  if (mentionsTopBest(query)) {
    return {
      intent: "top_cta",
      params: {
        query,
        days,
        event: DEFAULT_EVENT,
        property: DEFAULT_PROPERTY,
      },
    };
  }

  // 4) Mentions CTA but no clear action -> default to top
  if (/\b(cta|appclipparameterr|parametre r|parameter r)\b/i.test(query)) {
    return {
      intent: "top_cta",
      params: {
        query,
        days,
        event: DEFAULT_EVENT,
        property: DEFAULT_PROPERTY,
      },
    };
  }

  // 5) Fallback
  return { intent: "fallback", params: { query } };
}