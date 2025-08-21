import dotenv from "dotenv";
dotenv.config();

// 🛠️ Log temporaire (debug uniquement)
console.log(
  "Loaded ENV:",
  process.env.MIXPANEL_PROJECT_ID,
  process.env.MIXPANEL_SERVICE_ACCOUNT,
  process.env.MIXPANEL_SECRET ? "SECRET_OK" : "SECRET_MISSING"
);
import fetch from "node-fetch";

const MIXPANEL_PROJECT_ID = process.env.MIXPANEL_PROJECT_ID;
const MIXPANEL_SERVICE_ACCOUNT = process.env.MIXPANEL_SERVICE_ACCOUNT;
const MIXPANEL_SECRET = process.env.MIXPANEL_SECRET;

if (!MIXPANEL_PROJECT_ID || !MIXPANEL_SERVICE_ACCOUNT || !MIXPANEL_SECRET) {
  throw new Error("Missing Mixpanel credentials in .env");
}

async function jql(script: string, params: Record<string, any> = {}) {
const url = `https://eu.mixpanel.com/api/2.0/jql?project_id=${MIXPANEL_PROJECT_ID}`;
  const auth = Buffer.from(
    `${MIXPANEL_SERVICE_ACCOUNT}:${MIXPANEL_SECRET}`
  ).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
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

// --- CTA example ---
export async function getCtaClicksCount(range: { from: string; to: string }) {
  const script = `
    function main() {
      return Events({
        from_date: params.from,
        to_date: params.to,
        event_selectors: [{ event: "User Authenticated" }]
      })
      .groupBy(["properties.appClipParameterR"], mixpanel.reducer.count());
    }
  `;

  const data = await jql(script, range);

  return data.map((row: any) => ({
    value: row.key[0],
    count: row.value,
  }));
}

// --- Schema explorer ---
export async function getSchema(range?: { from: string; to: string }) {
  const eventScript = `
    function main() {
      return Events({
        from_date: params.from,
        to_date: params.to,
      })
      .groupBy(["name"], mixpanel.reducer.count());
    }
  `;

  const propsScript = `
    function main() {
      return Events({
        from_date: params.from,
        to_date: params.to,
        event_selectors: [{ event: params.event }]
      })
      .map(function(e){ return e.properties; });
    }
  `;

  // Liste des events
  const events = await jql(eventScript, range);

  const schema: Record<string, string[]> = {};
  for (const ev of events) {
    const eventName = ev.key[0];
    // Pour chaque event, va chercher ses propriétés
    const props = await jql(propsScript, { ...range, event: eventName });
    schema[eventName] = Object.keys(props[0] || {});
  }

  return schema;
}