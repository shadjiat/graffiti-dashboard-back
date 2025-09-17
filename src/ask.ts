// src/ask.ts
import "dotenv/config";
import { routeQuery } from "./agent/router";

// ⚠️ On utilise les handlers purs (fonctions), pas les objets Flow.
import { analyzeCtaPerformanceHandler } from "./flows/analyze-cta-performance";
import { ctaTimeseriesHandler } from "./flows/cta-timeseries";

/**
 * Usage:
 *   npx tsx src/ask.ts "Quels sont les CTA les plus performants sur 30 jours ?"
 *   npx tsx src/ask.ts "Montre l'évolution des CTA par jour sur 7 jours"
 */
async function main() {
  const q = process.argv.slice(2).join(" ").trim();
  if (!q) {
    console.error('Please provide a question, e.g.: npx tsx src/ask.ts "Top CTA last 30 days"');
    process.exit(1);
  }

  const routed = routeQuery(q);
  console.log("🔎 Routed intent:", routed.intent);

  try {
    if (routed.intent === "top_cta") {
      const res = await analyzeCtaPerformanceHandler({
        days: routed.params.days,
        event: routed.params.event,
        property: routed.params.property,
        // limit: optionnel — ajouté si tu veux limiter davantage
      });
      console.log("✅ Result:\n", JSON.stringify(res, null, 2));
      return;
    }

    if (routed.intent === "cta_timeseries") {
      const p = routed.params;
      const res = await ctaTimeseriesHandler({
        event: p.event,
        property: p.property,
        days: p.days,
        top: p.top,
        granularity: p.granularity,
      } as any);
      console.log("✅ Result:\n", JSON.stringify(res, null, 2));
      return;
    }

    console.log("🤷 Fallback — I couldn't route that. Try mentioning 'top' or 'évolution/over time'.");
  } catch (err) {
    console.error("❌ Error while answering:", err);
    process.exit(1);
  }
}

main();