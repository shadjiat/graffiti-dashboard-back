import "dotenv/config";
import fetch from "node-fetch";

const PID = process.env.MIXPANEL_PROJECT_ID!;
const USER = process.env.MIXPANEL_SERVICE_ACCOUNT!;
const SECRET = process.env.MIXPANEL_SECRET!;
if (!PID || !USER || !SECRET) {
  throw new Error("Missing MIXPANEL_PROJECT_ID / MIXPANEL_SERVICE_ACCOUNT / MIXPANEL_SECRET in .env");
}
const AUTH = "Basic " + Buffer.from(`${USER}:${SECRET}`).toString("base64");

async function jql(baseUrl: string, script: string, params: any = {}) {
  const res = await fetch(`${baseUrl}/api/2.0/jql?project_id=${PID}`, {
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
  const text = await res.text();
  return { ok: res.ok, status: res.status, statusText: res.statusText, text };
}

async function probeCluster() {
  const script = `function main(){ return [1]; }`;
  const us = await jql("https://mixpanel.com", script);
  const eu = await jql("https://eu.mixpanel.com", script);

  let cluster: "US" | "EU" | "Unknown" = "Unknown";
  let chosen = "https://mixpanel.com";
  // Heuristique : si l’un retourne un message de “invalid project id for cluster” et l’autre passe/renvoie 200
  if (eu.ok) cluster = "EU", chosen = "https://eu.mixpanel.com";
  else if (us.ok) cluster = "US", chosen = "https://mixpanel.com";
  else {
    // si aucun OK, on essaie d’inférer via les messages
    if (/project_cluster:\s*mixpanel-prod-eu/i.test(us.text)) cluster = "EU", chosen = "https://eu.mixpanel.com";
    if (/project_cluster:\s*mixpanel-prod-1/i.test(eu.text)) cluster = "US", chosen = "https://mixpanel.com";
  }
  return { cluster, chosen, us, eu };
}

async function probeFeatures(baseUrl: string) {
  const results: Record<string, { ok: boolean; reason?: string }> = {};

  // Base: simple retour
  {
    const r = await jql(baseUrl, `function main(){ return [ {value:1,count:2}, {value:2,count:1} ]; }`);
    results["base-array"] = { ok: r.ok, reason: r.text.slice(0, 200) };
  }

  // Essayons un pipeline minimal sans tri
  {
    const r = await jql(
      baseUrl,
      `
      function main() {
        return Events({from_date:"${new Date(Date.now()-7*864e5).toISOString().slice(0,10)}", to_date:"${new Date().toISOString().slice(0,10)}"})
          .map(function(e){ return {key: e.name, count: 1}; })
          .groupBy(["key"], mixpanel.reducer.sum("count"))
          .map(function(row){ return { value: row.key, count: row.value }; });
      }`
    );
    results["pipeline-basic(no-sort)"] = { ok: r.ok, reason: r.text.slice(0, 200) };
  }

  // Test .sort() dans JQL
  {
    const r = await jql(
      baseUrl,
      `
      function main() {
        return Events({from_date:"${new Date(Date.now()-7*864e5).toISOString().slice(0,10)}", to_date:"${new Date().toISOString().slice(0,10)}"})
          .map(function(e){ return {key: e.name, count: 1}; })
          .groupBy(["key"], mixpanel.reducer.sum("count"))
          .map(function(row){ return { value: row.key, count: row.value }; })
          .sort(function(a,b){ return b.count - a.count; });
      }`
    );
    results["sort()"] = { ok: r.ok, reason: r.text.slice(0, 200) };
  }

  // Test .orderBy([...])
  {
    const r = await jql(
      baseUrl,
      `
      function main() {
        return Events({from_date:"${new Date(Date.now()-7*864e5).toISOString().slice(0,10)}", to_date:"${new Date().toISOString().slice(0,10)}"})
          .map(function(e){ return {key: e.name, count: 1}; })
          .groupBy(["key"], mixpanel.reducer.sum("count"))
          .map(function(row){ return { value: row.key, count: row.value }; })
          .orderBy(["-count"]);
      }`
    );
    results["orderBy()"] = { ok: r.ok, reason: r.text.slice(0, 200) };
  }

  // Test .toList()
  {
    const r = await jql(
      baseUrl,
      `
      function main() {
        return Events({from_date:"${new Date(Date.now()-7*864e5).toISOString().slice(0,10)}", to_date:"${new Date().toISOString().slice(0,10)}"})
          .map(function(e){ return {key: e.name, count: 1}; })
          .groupBy(["key"], mixpanel.reducer.sum("count"))
          .map(function(row){ return { value: row.key, count: row.value }; })
          .toList();
      }`
    );
    results["toList()"] = { ok: r.ok, reason: r.text.slice(0, 200) };
  }

  return results;
}

(async () => {
  console.log("🔎 Probing Mixpanel cluster & JQL capabilities…");
  const cl = await probeCluster();
  console.log("• Cluster guess:", cl.cluster, "— chosen base:", cl.chosen);
  if (!/EU|US/.test(cl.cluster)) {
    console.log("US resp:", cl.us.status, cl.us.statusText);
    console.log(cl.us.text.slice(0, 200));
    console.log("EU resp:", cl.eu.status, cl.eu.statusText);
    console.log(cl.eu.text.slice(0, 200));
    process.exit(1);
  }

  const feats = await probeFeatures(cl.chosen);
  console.log("• Feature support:");
  for (const k of Object.keys(feats)) {
    console.log(`   - ${k}: ${feats[k].ok ? "OK" : "NOT SUPPORTED"}`);
    if (!feats[k].ok) console.log("     reason:", feats[k].reason);
  }
})();