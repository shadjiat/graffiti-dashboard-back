// src/flows/questions-top-mp.ts
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
    throw new Error(`Mixpanel JQL error: ${res.status} ${res.statusText} – ${await res.text()}`);
  }
  return res.json();
}

/** ====== JQL (compat EU cluster, pas de sort/toList) ====== */
/** Regroupe par valeur d'une propriété et compte les occurrences dans la fenêtre temporelle. */
const JQL_TOP_QUESTIONS = `
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

/** ====== SCHEMAS (local pour robustesse) ====== */
const InputSchema = z.object({
  event: z.string().default("User Question"),
  property: z.string().default("question"),
  days: z.number().int().positive().default(30),
  top: z.number().int().positive().default(10),
});
type Input = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  answer: z.string(),
  used: z.object({
    event: z.string(),
    property: z.string(),
    from: z.string(),
    to: z.string(),
    top: z.number().int().positive(),
  }),
  items: z.array(z.object({ value: z.string(), count: z.number() })),
});
type Output = z.infer<typeof OutputSchema>;

/** ====== HANDLER MIXPANEL ====== */
export async function questionsTopHandlerMP(input: Input): Promise<Output> {
  const to = daysAgo(0);
  const from = daysAgo(input.days);

  const rows = (await jql(JQL_TOP_QUESTIONS, {
    event: input.event,
    property: input.property,
    from,
    to,
  })) as Array<{ value: string; count: number }>;

  rows.sort((a, b) => b.count - a.count);
  const items = rows.slice(0, input.top);

  return {
    answer: `Top ${input.top} "${input.property}" observés sur "${input.event}" entre ${from} et ${to}.`,
    used: {
      event: input.event,
      property: input.property,
      from,
      to,
      top: input.top,
    },
    items,
  };
}