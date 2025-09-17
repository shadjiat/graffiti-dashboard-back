// src/server.ts
import * as path from "node:path";
import * as fs from "node:fs";
import * as dotenv from "dotenv";
const envPath = path.resolve(process.cwd(), ".env");
console.log("[BOOT] Loading .env from:", envPath, "exists:", fs.existsSync(envPath));
dotenv.config({ path: envPath });

import express, { Request } from "express";
import cors from "cors";

// Router regex (fallback)
import { routeQuery } from "./agent/router";

// Flows/handlers Mixpanel
import { ctaTimeseriesHandler } from "./flows/cta-timeseries";
import { analyzeCtaPerformanceHandler } from "./flows/analyze-cta-performance";

// Gemini router (LLM)
import { routeWithGemini } from "./ai/gemini";

// Domain pack loader
import { loadDomainPack } from "./domain/loader";

// Reco catalogue
import { recommendProducts } from "./catalog/recommend";

// NEW: Questions top
import { questionsTopHandler } from "./flows/questions-top";

const app = express();

/** CORS (dev: ouvert ; à restreindre en prod si besoin) */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
  })
);

/** Reconstruit l’URL de base (http(s) + host) depuis la requête. */
function getBaseUrl(req: Request) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (req.headers["x-forwarded-protocol"] as string) ||
    req.protocol ||
    "http";

  const host =
    (req.headers["x-forwarded-host"] as string) ||
    req.get("host") ||
    "localhost:3001";

  return `${proto}://${host}`;
}

/** Parse util: values=cta01,cta02 -> ["cta01","cta02"] */
function parseValuesParam(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) {
    const flat = v.flatMap((s) => String(s).split(","));
    const cleaned = flat.map((s) => s.trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  const cleaned = String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function parsePositiveInteger(raw: unknown): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function isGranularity(value: string): value is "day" | "week" | "month" {
  return value === "day" || value === "week" || value === "month";
}

/** Health check */
app.get("/health", (_req, res) => {
  const ok =
    !!process.env.MIXPANEL_PROJECT_ID &&
    !!process.env.MIXPANEL_SERVICE_ACCOUNT &&
    !!process.env.MIXPANEL_SECRET;

  res.json({
    ok,
    env: {
      MIXPANEL_PROJECT_ID: process.env.MIXPANEL_PROJECT_ID ? "SET" : "MISSING",
      MIXPANEL_SERVICE_ACCOUNT: process.env.MIXPANEL_SERVICE_ACCOUNT ? "SET" : "MISSING",
      MIXPANEL_SECRET: process.env.MIXPANEL_SECRET ? "SET" : "MISSING",
      MIXPANEL_API_HOST: process.env.MIXPANEL_API_HOST || "(default)",
      GEMINI_MODEL: process.env.GEMINI_MODEL || "(default)",
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? "SET" : "MISSING",
    },
    note: "Env looks good. Ready for API endpoints.",
  });
});

/** /_urls — URLs prêtes à copier selon l’hôte courant */
app.get("/_urls", (req, res) => {
  const base = getBaseUrl(req);

  const health = `${base}/health`;
  const timeseries = `${base}/cta-timeseries?event=${encodeURIComponent(
    "User Authenticated"
  )}&property=${encodeURIComponent("appClipParameterR")}&days=30&top=5&granularity=day`;
  const timeseriesWithValues = `${base}/cta-timeseries?event=${encodeURIComponent(
    "User Authenticated"
  )}&property=${encodeURIComponent("appClipParameterR")}&days=7&granularity=day&values=${encodeURIComponent(
    "cta01,cta02"
  )}`;
  const askTop = `${base}/ask?q=${encodeURIComponent("Top CTA last 30 days")}`;
  const askTimeseries = `${base}/ask?q=${encodeURIComponent(
    "Montre l'évolution des CTA par jour sur 30 jours"
  )}`;
  const askCompare = `${base}/ask?q=${encodeURIComponent(
    "Compare les performances de cta01 et cta02 sur les 7 derniers jours"
  )}`;

  // variantes avec domain=wine, + un exemple recommend
  const askCompareWine = `${askCompare}&domain=wine`;
  const askTimeseriesWine = `${askTimeseries}&domain=wine`;
  const askRecommendWine = `${base}/ask?q=${encodeURIComponent(
    "Recommande un vin rouge léger autour de 15€ pour l'apéro"
  )}&domain=wine`;

  // NEW: exemple "questions_top"
  const askQuestionsTop = `${base}/ask?q=${encodeURIComponent(
    "Qu'est-ce que demandent le plus les clients ?"
  )}`;

  const embed = `${base}/embed`;
  const embedReco = `${base}/embed-reco`;
  const domainPack = `${base}/domain-pack?id=wine`;

  res.json({
    base,
    health,
    timeseries,
    timeseriesWithValues,
    askTop,
    askTimeseries,
    askCompare,
    askTimeseriesWine,
    askCompareWine,
    askRecommendWine,
    askQuestionsTop,
    embed,
    embedReco,
    domainPack,
    note: "Ces URLs tiennent compte automatiquement de l’hôte (Codespaces/localhost).",
  });
});

/** /_links — même contenu que /_urls mais en HTML cliquable */
app.get("/_links", (req, res) => {
  const base = getBaseUrl(req);

  const urls = {
    base,
    health: `${base}/health`,
    timeseries: `${base}/cta-timeseries?event=${encodeURIComponent(
      "User Authenticated"
    )}&property=${encodeURIComponent("appClipParameterR")}&days=30&top=5&granularity=day`,
    timeseriesWithValues: `${base}/cta-timeseries?event=${encodeURIComponent(
      "User Authenticated"
    )}&property=${encodeURIComponent("appClipParameterR")}&days=7&granularity=day&values=${encodeURIComponent(
      "cta01,cta02"
    )}`,
    askTop: `${base}/ask?q=${encodeURIComponent("Top CTA last 30 days")}`,
    askTimeseries: `${base}/ask?q=${encodeURIComponent(
      "Montre l'évolution des CTA par jour sur 30 jours"
    )}`,
    askCompare: `${base}/ask?q=${encodeURIComponent(
      "Compare les performances de cta01 et cta02 sur les 7 derniers jours"
    )}`,
    askTimeseriesWine: `${base}/ask?q=${encodeURIComponent(
      "Montre l'évolution des CTA par jour sur 30 jours"
    )}&domain=wine`,
    askCompareWine: `${base}/ask?q=${encodeURIComponent(
      "Compare les performances de cta01 et cta02 sur les 7 derniers jours"
    )}&domain=wine`,
    askRecommendWine: `${base}/ask?q=${encodeURIComponent(
      "Recommande un vin rouge léger autour de 15€ pour l'apéro"
    )}&domain=wine`,
    askQuestionsTop: `${base}/ask?q=${encodeURIComponent(
      "Qu'est-ce que demandent le plus les clients ?"
    )}`,
    embed: `${base}/embed`,
    embedReco: `${base}/embed-reco`,
    domainPack: `${base}/domain-pack?id=wine`,
    urlsJson: `${base}/_urls`,
  };

  res
    .type("html")
    .send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Graffiti Analytics – Liens</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px}
    ul{line-height:1.9}
    code{background:#f6f6f6;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
  <h1>Liens prêts à tester</h1>
  <ul>
    ${Object.entries(urls)
      .map(([k, v]) => `<li><a href="${v}" target="_blank">${k}</a><br/><code>${v}</code></li>`)
      .join("")}
  </ul>
  <p style="color:#666">Générés dynamiquement selon l’hôte (Codespaces/localhost).</p>
</body>
</html>`);
});

/**
 * /cta-timeseries
 * Supporte &values=cta01,cta02 (prioritaire sur &top=5)
 */
app.get("/cta-timeseries", async (req, res) => {
  try {
    const eventRaw = Array.isArray(req.query.event) ? req.query.event[0] : req.query.event;
    const propertyRaw = Array.isArray(req.query.property)
      ? req.query.property[0]
      : req.query.property;
    const event = typeof eventRaw === "string" ? eventRaw.trim() : "";
    const property = typeof propertyRaw === "string" ? propertyRaw.trim() : "";

    const daysRaw = Array.isArray(req.query.days) ? req.query.days[0] : req.query.days;
    let days = 30;
    if (daysRaw !== undefined) {
      const parsed = parsePositiveInteger(daysRaw);
      if (parsed === null) {
        return res
          .status(400)
          .json({ error: "Invalid query param: days must be a positive integer." });
      }
      days = parsed;
    }

    const topRaw = Array.isArray(req.query.top) ? req.query.top[0] : req.query.top;
    let top = 5;
    if (topRaw !== undefined) {
      const parsed = parsePositiveInteger(topRaw);
      if (parsed === null) {
        return res
          .status(400)
          .json({ error: "Invalid query param: top must be a positive integer." });
      }
      top = parsed;
    }

    const granularityRaw = Array.isArray(req.query.granularity)
      ? req.query.granularity[0]
      : req.query.granularity;
    let granularity: "day" | "week" | "month" = "day";
    if (granularityRaw !== undefined) {
      const normalized = String(granularityRaw).toLowerCase();
      if (!isGranularity(normalized)) {
        return res.status(400).json({
          error: "Invalid query param: granularity must be one of day, week or month.",
        });
      }
      granularity = normalized;
    }

    const values = parseValuesParam(req.query.values);

    if (!event || !property) {
      return res.status(400).json({
        error: "Missing required query params: event, property",
        example:
          "/cta-timeseries?event=User%20Authenticated&property=appClipParameterR&days=30&top=5&granularity=day",
      });
    }

    const result = await ctaTimeseriesHandler({
      event,
      property,
      days,
      top,
      granularity,
      values, // prioritaire si présent (géré dans le handler)
    } as any);
    res.json(result);
  } catch (err: any) {
    console.error("Error in /cta-timeseries:", err?.stack || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/**
 * /ask — NLQ → intent via Gemini, sinon fallback regex
 * Ajout: ?domain=wine [&tenantId=xxx] pour charger un DomainPack et le passer à Gemini.
 * Si Gemini renvoie params.values, on les passe au handler.
 */
app.get("/ask", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing query param: q" });

  // Optionnel: domain pack
  const domainId = req.query.domain ? String(req.query.domain) : undefined;
  const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
  let pack: any = undefined;
  if (domainId) {
    try {
      pack = loadDomainPack(domainId, tenantId);
    } catch (e) {
      console.warn("[/ask] Domain pack load failed:", (e as any)?.message);
    }
  }

  let source: "gemini" | "regex_fallback" = "gemini";
  let intent: "top_cta" | "cta_timeseries" | "recommend" | "questions_top" | "fallback";
  let params:
    | {
        query?: string;
        days?: number;
        event?: string;
        property?: string;
        granularity?: "day" | "week" | "month";
        top?: number;
        values?: string[];
        // recommend:
        filters?: Record<string, string[]>;
        budget_eur?: number | null;
      }
    | undefined;

  try {
    const routed = await routeWithGemini(q, pack);
    intent = routed.intent as any;
    params = (routed as any).params;
    source = "gemini";
  } catch {
    const routed = routeQuery(q) as any;
    if (routed.intent === "fallback") {
      return res.status(400).json({
        intent: "fallback",
        source: "regex_fallback",
        question: q,
        hint: "Essaie de mentionner 'top' / 'meilleurs' ou 'évolution' / 'over time'.",
      });
    }
    intent = routed.intent;
    params = routed.params;
    source = "regex_fallback";
  }

  try {
    if (intent === "top_cta") {
      const out = await analyzeCtaPerformanceHandler({
        event: params?.event,
        property: params?.property,
        days: params?.days,
      });
      return res.json({ intent, source, question: q, domain: domainId, tenantId, ...out });
    }

    if (intent === "cta_timeseries") {
      const out = await ctaTimeseriesHandler({
        event: params?.event || "User Authenticated",
        property: params?.property || "appClipParameterR",
        days: params?.days ?? 30,
        top: params?.top ?? 5,
        granularity: (params?.granularity as "day" | "week" | "month") ?? "day",
        values: Array.isArray(params?.values) ? params!.values : undefined,
      } as any);
      return res.json({ intent, source, question: q, domain: domainId, tenantId, ...out });
    }

    if (intent === "recommend") {
      const domain = domainId || "wine";
      const reco = recommendProducts({
        domainId: domain,
        filters: params?.filters || {},
        budget_eur: params?.budget_eur ?? null,
        pack, // pour les synonymes/normalisation
        limit: 10,
      });
      return res.json({
        intent,
        source,
        question: q,
        domain: domainId,
        tenantId,
        recommend: {
          filters: params?.filters || {},
          budget_eur: params?.budget_eur ?? null,
        },
        result: reco,
      });
    }

    if (intent === "questions_top") {
      const out = await questionsTopHandler({
        event: (params?.event as string) || "User Question",
        property: (params?.property as string) || "question",
        days: typeof params?.days === "number" ? params!.days! : 30,
        top: typeof params?.top === "number" ? params!.top! : 10,
      });
      return res.json({ intent, source, question: q, domain: domainId, tenantId, ...out });
    }

    return res.status(400).json({ intent: "fallback", source, question: q, hint: "Aucune intention exploitable." });
  } catch (err: any) {
    console.error("Error in /ask:", err?.stack || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** /embed — mini UI HTML avec courbe de comparaison (Chart.js) */
app.get("/embed", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Graffiti Analytics – Demo Embed</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  :root { --muted:#888; --bg:#fff; }
  html,body{ background:var(--bg); }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 24px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
  input[type=text]{ flex:1; min-width:280px; padding:10px; font-size:16px; }
  button{ padding:10px 14px; font-size:16px; cursor:pointer; }
  .hint{ color:#666; margin-top:6px; font-size:13px; }
  pre{ background:#f7f7f7; padding:12px; overflow:auto; border-radius:8px; }
  .muted{ color:#666; font-size:12px; }
  .src{ display:inline-block; padding:2px 6px; border-radius:6px; font-size:12px; margin-left:6px; background:#eef; }
  .panel{ margin-top:18px; }
  .chart-wrap{ margin-top:12px; background:#fff; border:1px solid #eee; border-radius:10px; padding:12px; }
  canvas{ max-width:100%; height:320px; }
</style>
</head>
<body>
  <h1>Graffiti Analytics – Demo Embed</h1>
  <div class="row">
    <input id="q" type="text" value="Compare les performances de cta01 et cta02 sur les 7 derniers jours" />
    <button id="askBtn">Poser la question</button>
    <button id="timeseriesBtn">Timeseries 30 jours</button>
    <button id="compareBtn">Comparer cta01 vs cta02 (7j)</button>
  </div>
  <div class="hint">
    Exemples: “Top CTA last 30 days”, “Montre l'évolution des CTA par jour sur 7 jours”, “Compare les performances de cta01 et cta02 sur les 7 derniers jours”.
  </div>

  <div class="panel">
    <h3>Réponse <span id="src" class="src" title="Source de routage">—</span></h3>
    <div id="answer" class="muted">—</div>
  </div>

  <div class="panel chart-wrap">
    <h3>Courbe de comparaison</h3>
    <canvas id="chart"></canvas>
  </div>

  <div class="panel">
    <h3>JSON brut</h3>
    <pre id="json">—</pre>
  </div>
  <script>
    const qEl=document.getElementById('q');
    const answerEl=document.getElementById('answer');
    const jsonEl=document.getElementById('json');
    const askBtn=document.getElementById('askBtn');
    const timeseriesBtn=document.getElementById('timeseriesBtn');
    const compareBtn=document.getElementById('compareBtn');
    const srcEl=document.getElementById('src');
    let chart;
    function ensureChart(){
      if(chart) return chart;
      const ctx=document.getElementById('chart').getContext('2d');
      chart=new Chart(ctx,{type:'line',data:{labels:[],datasets:[]},options:{responsive:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom'},tooltip:{callbacks:{label:(ctx)=>\`\${ctx.dataset.label}: \${ctx.parsed.y}\`}}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}});return chart;
    }
    function updateChart(data){
      if(!data||!Array.isArray(data.series)||!Array.isArray(data.dates)){ if(chart){chart.data.labels=[];chart.data.datasets=[];chart.update();} return; }
      const labels=data.dates;
      const datasets=data.series.map((s)=>({label:s.value??'—',data:Array.isArray(s.points)?s.points.map(p=> (typeof p.count==='number'?p.count:0)):[],borderWidth:2,fill:false,tension:0.2,pointRadius:2}));
      const c=ensureChart(); c.data.labels=labels; c.data.datasets=datasets; c.update();
    }
    async function runAsk(text){
      const url='/ask?q='+encodeURIComponent(text);
      answerEl.textContent='Chargement...'; jsonEl.textContent='...'; srcEl.textContent='—';
      try{ const r=await fetch(url); const data=await r.json(); if(!r.ok){ throw new Error((data&&data.error)||r.statusText); }
        srcEl.textContent=data.source||'—'; srcEl.style.background=data.source==='gemini'?'#e6ffe6':'#fff3cd';
        answerEl.textContent=(data.source?('['+data.source+'] '):'')+(data.answer||JSON.stringify(data));
        jsonEl.textContent=JSON.stringify(data,null,2); updateChart(data);
      }catch(err){ answerEl.textContent='Erreur: '+(err&&err.message||err); srcEl.textContent='—'; updateChart(null); }
    }
    askBtn.addEventListener('click',()=>runAsk(qEl.value));
    timeseriesBtn.addEventListener('click',()=>{ qEl.value="Montre l'évolution des CTA par jour sur 30 jours"; runAsk(qEl.value); });
    compareBtn.addEventListener('click',()=>{ qEl.value="Compare les performances de cta01 et cta02 sur les 7 derniers jours"; runAsk(qEl.value); });
    runAsk(qEl.value);
  </script>
</body>
</html>`);
});

/** === NOUVEAU : mini UI pour les recommandations produit === */
app.get("/embed-reco", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Graffiti Reco – Demo</title>
<style>
  :root{ --text:#111; --muted:#666; --bg:#fff; --card:#fff; --border:#eee; }
  html,body{ background:var(--bg); color:var(--text); }
  body{ font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:24px; }
  .row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  input[type=text]{ flex:1; min-width:320px; padding:10px; font-size:16px; }
  select,button{ padding:10px 14px; font-size:16px; cursor:pointer; }
  .hint{ color:var(--muted); margin-top:6px; font-size:13px; }
  .panel{ margin-top:18px; }
  .grid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap:12px; margin-top:12px; }
  .card{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px; }
  .price{ font-weight:600; }
  .badge{ display:inline-block; background:#f2f2f8; border:1px solid var(--border); padding:2px 6px; border-radius:999px; font-size:12px; margin-right:6px; margin-top:6px;}
  pre{ background:#f7f7f7; padding:12px; overflow:auto; border-radius:8px; }
  .src{ display:inline-block; padding:2px 6px; border-radius:6px; font-size:12px; margin-left:6px; background:#eef; }
</style>
</head>
<body>
  <h1>Graffiti Reco – Demo</h1>
  <div class="row">
    <input id="q" type="text" value="Recommande un vin rouge léger autour de 15€ pour l'apéro" />
    <select id="domain">
      <option value="wine" selected>wine</option>
    </select>
    <button id="go">Recommander</button>
    <button id="ex1">Rouge léger ~15€</button>
    <button id="ex2">Un blanc fruité pour du poisson</button>
    <button id="ex3">Des bulles autour de 25€</button>
  </div>
  <div class="hint">Cette page appelle <code>/ask?q=...&domain=...</code> et affiche les items retournés quand l'intention est <code>recommend</code>.</div>

  <div class="panel">
    <h3>Résultats <span id="src" class="src">—</span></h3>
    <div id="cards" class="grid"></div>
  </div>

  <div class="panel">
    <h3>JSON brut</h3>
    <pre id="json">—</pre>
  </div>

<script>
  const qEl   = document.getElementById('q');
  const domEl = document.getElementById('domain');
  const goEl  = document.getElementById('go');
  const ex1   = document.getElementById('ex1');
  const ex2   = document.getElementById('ex2');
  const ex3   = document.getElementById('ex3');
  const cards = document.getElementById('cards');
  const jsonEl= document.getElementById('json');
  const srcEl = document.getElementById('src');

  function h(tag, attrs={}, children=[]){
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    (Array.isArray(children)?children:[children]).filter(Boolean).forEach(c=>{
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function renderCards(data){
    cards.innerHTML = '';
    const items = data && data.result && Array.isArray(data.result.items) ? data.result.items : [];
    if (!items.length) {
      cards.appendChild(h('div', {class:'muted'}, 'Aucun résultat.'));
      return;
    }
    items.forEach((it)=>{
      const f = it.facets || {};
      const head = h('div', {}, [
        h('div', {style:'font-weight:600; margin-bottom:4px;'}, it.name || it.sku || '—'),
        h('div', {class:'price'}, (typeof it.price_eur === 'number' ? it.price_eur.toFixed(2)+' €' : ''))
      ]);
      const badges = h('div', {}, [
        f.color ? h('span', {class:'badge'}, f.color) : null,
        Array.isArray(f.taste_profile) ? f.taste_profile.map(v => h('span',{class:'badge'}, v)) : null,
        f.origin ? h('span', {class:'badge'}, f.origin) : null,
        f.label ? h('span', {class:'badge'}, f.label) : null,
        f.grape ? h('span', {class:'badge'}, f.grape) : null
      ].flat());
      const card = h('div', {class:'card'}, [head, badges]);
      cards.appendChild(card);
    });
  }

  async function run(){
    const q = qEl.value;
    const d = domEl.value || 'wine';
    cards.innerHTML = '<div class="muted">Chargement…</div>';
    jsonEl.textContent = '...';
    srcEl.textContent = '—';
    try{
      const url = '/ask?q=' + encodeURIComponent(q) + '&domain=' + encodeURIComponent(d);
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok) throw new Error((data && data.error) || r.statusText);
      srcEl.textContent = (data.intent || '') + (data.source ? ' · ' + data.source : '');
      renderCards(data);
      jsonEl.textContent = JSON.stringify(data, null, 2);
    }catch(err){
      cards.innerHTML = '<div class="muted">Erreur: ' + (err && err.message || err) + '</div>';
      jsonEl.textContent = String(err && err.message || err);
    }
  }

  goEl.addEventListener('click', run);
  ex1.addEventListener('click', () => { qEl.value = "Recommande un vin rouge léger autour de 15€ pour l'apéro"; run(); });
  ex2.addEventListener('click', () => { qEl.value = "Un blanc fruité pour du poisson"; run(); });
  ex3.addEventListener('click', () => { qEl.value = "Des bulles autour de 25€"; run(); });

  run();
</script>
</body>
</html>`);
});

/** === Expose le pack domaine pour vérification rapide === */
app.get("/domain-pack", (req, res) => {
  try {
    const id = String(req.query.id || "wine");
    const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
    const pack = loadDomainPack(id, tenantId);
    res.json({ ok: true, id, tenantId, pack });
  } catch (err: any) {
    console.error("Error in /domain-pack:", err?.stack || err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/** Démarrage */
const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`HTTP server listening on http://localhost:${PORT}`);
  console.log(`Health:       GET  http://localhost:${PORT}/health`);
  console.log(`Timeseries:   GET  http://localhost:${PORT}/cta-timeseries?event=User%20Authenticated&property=appClipParameterR&days=30&top=5&granularity=day`);
  console.log(`Ask:          GET  http://localhost:${PORT}/ask?q=Top%20CTA%20last%2030%20days`);
  console.log(`Embed:        GET  http://localhost:${PORT}/embed`);
  console.log(`EmbedReco:    GET  http://localhost:${PORT}/embed-reco`);
  console.log(`URLs:         GET  http://localhost:${PORT}/_urls   <-- liens complets prêts à copier`);
  console.log(`Links:        GET  http://localhost:${PORT}/_links  <-- liens cliquables (HTML)`);
  console.log(`DomainPack:   GET  http://localhost:${PORT}/domain-pack?id=wine`);
});