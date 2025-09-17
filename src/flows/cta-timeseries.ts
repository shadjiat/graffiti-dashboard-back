// src/flows/cta-timeseries.ts
import { defineFlow } from "@genkit-ai/flow";
import { z } from "zod";
import "dotenv/config";
import fetch from "node-fetch";

/** ====== ENV / CONFIG ====== */
const MIXPANEL_PROJECT_ID = process.env.MIXPANEL_PROJECT_ID!;
const MIXPANEL_USERNAME   = process.env.MIXPANEL_SERVICE_ACCOUNT!;
const MIXPANEL_SECRET     = process.env.MIXPANEL_SECRET!;
const API_HOST            = process.env.MIXPANEL_API_HOST || "https://eu.mixpanel.com";

if (!MIXPANEL_PROJECT_ID || !MIXPANEL_USERNAME || !MIXPANEL_SECRET) {
  throw new Error("Missing Mixpanel env (MIXPANEL_PROJECT_ID, MIXPANEL_SERVICE_ACCOUNT, MIXPANEL_SECRET).");
}

const AUTH = "Basic " + Buffer.from(`${MIXPANEL_USERNAME}:${MIXPANEL_SECRET}`).toString("base64");
const JQL_URL = `${API_HOST}/api/2.0/jql?project_id=${MIXPANEL_PROJECT_ID}`;

/** ====== HELPERS ====== */
type Granularity = "day" | "week" | "month";

function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00.000Z");
  const end = new Date(to + "T00:00:00.000Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function startOfWeek(date: string) {
  const d = new Date(date + "T00:00:00.000Z");
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // 0 for Monday, 6 for Sunday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date: string) {
  const d = new Date(date + "T00:00:00.000Z");
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

function bucketStart(date: string, granularity: Granularity): string {
  if (granularity === "week") return startOfWeek(date);
  if (granularity === "month") return startOfMonth(date);
  return date;
}

function collectBuckets(days: string[], granularity: Granularity): string[] {
  if (granularity === "day") return days;
  const seen = new Set<string>();
  const buckets: string[] = [];
  for (const day of days) {
    const bucket = bucketStart(day, granularity);
    if (!seen.has(bucket)) {
      seen.add(bucket);
      buckets.push(bucket);
    }
  }
  return buckets;
}

function buildSeriesForGranularity(
  values: string[],
  days: string[],
  byValue: Record<string, Record<string, number>>,
  granularity: Granularity
) {
  const bucketDates = collectBuckets(days, granularity);
  const series = values.map((value) => {
    const valueMap = byValue[value] || {};
    if (granularity === "day") {
      const points = days.map((d) => ({ date: d, count: valueMap[d] ?? 0 }));
      const total = points.reduce((acc, p) => acc + p.count, 0);
      return { value, total, points };
    }

    const bucketCounts: Record<string, number> = {};
    for (const day of days) {
      const bucket = bucketStart(day, granularity);
      bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + (valueMap[day] ?? 0);
    }
    const points = bucketDates.map((bucket) => ({
      date: bucket,
      count: bucketCounts[bucket] ?? 0,
    }));
    const total = points.reduce((acc, p) => acc + p.count, 0);
    return { value, total, points };
  });

  return { series, dates: bucketDates };
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
    throw new Error(`Mixpanel JQL error: ${res.status} ${res.statusText} – ${await res.text()}`);
  }
  return res.json();
}

/** ====== JQL (compat EU cluster, pas de sort/toList) ====== */

/** 1) Top N valeurs d’une propriété (sur la fenêtre) */
const JQL_TOP_VALUES = `
function main(){
  return Events({ from_date: params.from, to_date: params.to })
    .filter(function(e){
      if (e.name !== params.event) return false;
      if (!e.properties) return false;
      var v = e.properties[params.property];
      return !(v === undefined || v === null || v === "");
    })
    .groupBy(
      [ function(e){ return e.properties[params.property]; } ],
      mixpanel.reducer.count()
    )
    .map(function(row){
      return { value: row.key[0], count: row.value };
    });
}
`;

/** 2) Timeseries (jour x valeur) pour un sous-ensemble de valeurs */
const JQL_TIMESERIES = `
function main(){
  return Events({ from_date: params.from, to_date: params.to })
    .filter(function(e){
      if (e.name !== params.event) return false;
      if (!e.properties) return false;
      var v = e.properties[params.property];
      if (v === undefined || v === null || v === "") return false;
      if (!params.keep[v]) return false;
      return true;
    })
    .groupBy(
      [
        function(e){
          var d = new Date(e.time);
          d.setUTCHours(0,0,0,0);
          return d.toISOString().slice(0,10);
        },
        function(e){ return e.properties[params.property]; }
      ],
      mixpanel.reducer.count()
    )
    .map(function(item){
      return { day: item.key[0], value: item.key[1], count: item.value };
    });
}
`;

/** ====== SCHEMAS ====== */
const InputSchema = z.object({
  event: z.string().default("User Authenticated"),
  property: z.string().default("appClipParameterR"),
  days: z.number().int().positive().default(30),
  top: z.number().int().positive().default(5),
  /** Permet de forcer les valeurs (ex: ["cta01","cta02"]). Si présent, prioritaire sur top. */
  values: z.array(z.string()).optional(),
  granularity: z.enum(["day", "week", "month"]).default("day"),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  answer: z.string(),
  used: z.object({
    event: z.string(),
    property: z.string(),
    from: z.string(),
    to: z.string(),
    granularity: z.enum(["day", "week", "month"]),
    top: z.number().int().positive().optional(),
    values: z.array(z.string()).optional(),
  }),
  series: z.array(
    z.object({
      value: z.string(),
      total: z.number(),
      points: z.array(z.object({ date: z.string(), count: z.number() })),
    })
  ),
  dates: z.array(z.string()),
});
type Output = z.infer<typeof OutputSchema>;

/** ====== HANDLER PUR (exporté) ====== */
export async function ctaTimeseriesHandler(input: Input): Promise<Output> {
  const to = daysAgo(0);
  const from = daysAgo(input.days);
  const days = dateRange(from, to);

  // Déterminer l’ensemble de valeurs à tracer
  let chosen: string[] = [];
  let usedTop: number | undefined;
  let usedValues: string[] | undefined;

  if (input.values && input.values.length > 0) {
    chosen = input.values.map((v) => String(v).trim()).filter(Boolean);
    usedValues = chosen.slice();
  } else {
    const topRows = (await jql(JQL_TOP_VALUES, {
      event: input.event,
      property: input.property,
      from,
      to,
    })) as Array<{ value: string; count: number }>;
    topRows.sort((a, b) => b.count - a.count);
    chosen = topRows.slice(0, input.top).map((r) => String(r.value));
    usedTop = input.top;
  }

  if (chosen.length === 0) {
    const bucketDates = collectBuckets(days, input.granularity);
    return {
      answer: `No data for "${input.event}" by "${input.property}" between ${from} and ${to}.`,
      used: {
        event: input.event,
        property: input.property,
        from,
        to,
        granularity: input.granularity,
        ...(usedTop ? { top: usedTop } : {}),
        ...(usedValues ? { values: usedValues } : {}),
      },
      series: [],
      dates: bucketDates,
    };
  }

  // Timeseries pour ces valeurs
  const keep: Record<string, boolean> = {};
  for (const v of chosen) keep[v] = true;

  const rows = (await jql(JQL_TIMESERIES, {
    event: input.event,
    property: input.property,
    from,
    to,
    keep,
  })) as Array<{ day: string; value: string; count: number }>;

  // Densification
  const byValue: Record<string, Record<string, number>> = {};
  for (const v of chosen) {
    byValue[v] = {};
    for (const d of days) byValue[v][d] = 0;
  }
  for (const r of rows) {
    if (byValue[r.value] && byValue[r.value][r.day] !== undefined) {
      byValue[r.value][r.day] = r.count;
    }
  }
  const { series, dates } = buildSeriesForGranularity(chosen, days, byValue, input.granularity);

  return {
    answer: `Timeseries for "${input.property}" on "${input.event}" from ${from} to ${to} (${usedValues ? `values=${JSON.stringify(usedValues)}` : `top ${usedTop} values`}, ${input.granularity}).`,
    used: {
      event: input.event,
      property: input.property,
      from,
      to,
      granularity: input.granularity,
      ...(usedTop ? { top: usedTop } : {}),
      ...(usedValues ? { values: usedValues } : {}),
    },
    series,
    dates,
  };
}

/** ====== FLOW QUI WRAPPE LE HANDLER ====== */
const ctaTimeseries = defineFlow(
  {
    name: "ctaTimeseries",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => ctaTimeseriesHandler(input)
);

export default ctaTimeseries;
export { ctaTimeseries };