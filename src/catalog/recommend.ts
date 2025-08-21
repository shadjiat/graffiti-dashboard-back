// src/catalog/recommend.ts
import { loadCatalog, CatalogItem } from "./loader";

type DomainPackLike = {
  synonyms?: Record<string, string>;
  facets?: Record<
    string,
    { values?: string[]; valueSynonyms?: Record<string, string> }
  >;
};

export type RecommendInput = {
  domainId: string; // ex: "wine"
  filters?: Record<string, string[]>;
  budget_eur?: number | null;
  pack?: DomainPackLike;
  limit?: number; // défaut 10
};

type Diagnostics = {
  unknownFacetKeys: string[];
  unknownFacetValues: Record<string, string[]>; // facet -> valeurs non reconnues
};

/** Normalise une valeur via les synonymes du pack (ex: "léger" -> "leger"). */
function normalizeValue(v: string, pack?: DomainPackLike): string {
  const s = (v || "").toString().toLowerCase().trim();
  if (!pack?.synonyms) return s;
  return pack.synonyms[s] ?? s;
}

/** Applique les valueSynonyms définis au niveau d'une facette (ex: rose -> rosé). */
function applyFacetValueSynonyms(
  value: string,
  facetKey: string,
  pack?: DomainPackLike
): string {
  const syn = pack?.facets?.[facetKey]?.valueSynonyms || {};
  return syn[value] ?? value;
}

/** Teste si un item matche toutes les facettes demandées. */
function matchFacets(
  item: CatalogItem,
  requested: Record<string, string[]>,
  pack?: DomainPackLike
): { matched: number; totalAsked: number } {
  const facets = item.facets || {};
  let matched = 0;
  let totalAsked = 0;

  for (const [facetKey, wantedValues] of Object.entries(requested || {})) {
    if (!wantedValues || wantedValues.length === 0) continue;
    totalAsked += 1;

    // Normalisation des valeurs demandées
    const wanted = wantedValues
      .map((v) => normalizeValue(v, pack))
      .map((v) => applyFacetValueSynonyms(v, facetKey, pack));

    const itemVal = facets[facetKey];
    if (itemVal == null) continue;

    // Les facettes peuvent être scalaires ou tableaux (ex: taste_profile)
    const itemVals: string[] = Array.isArray(itemVal)
      ? itemVal.map((v) => normalizeValue(String(v), pack))
      : [normalizeValue(String(itemVal), pack)];

    const itemValsNorm = itemVals.map((v) =>
      applyFacetValueSynonyms(v, facetKey, pack)
    );

    const ok = wanted.some((w) => itemValsNorm.includes(w));
    if (ok) matched += 1;
  }

  return { matched, totalAsked };
}

/** Analyse les filtres par rapport au pack pour produire des diagnostics utiles. */
function computeDiagnostics(
  filters: Record<string, string[]>,
  pack?: DomainPackLike
): Diagnostics {
  const diags: Diagnostics = { unknownFacetKeys: [], unknownFacetValues: {} };
  const knownFacetKeys = new Set(Object.keys(pack?.facets || {}));

  for (const [facetKey, values] of Object.entries(filters || {})) {
    if (!knownFacetKeys.has(facetKey)) {
      diags.unknownFacetKeys.push(facetKey);
      continue;
    }

    const allowed = new Set(
      (pack?.facets?.[facetKey]?.values || []).map((v) =>
        normalizeValue(v, pack)
      )
    );
    const valueSyn = pack?.facets?.[facetKey]?.valueSynonyms || {};

    const unknowns: string[] = [];
    for (const raw of values || []) {
      const norm = normalizeValue(raw, pack);
      const withFacetSyn = valueSyn[norm] ?? norm;
      if (!allowed.has(withFacetSyn)) {
        unknowns.push(raw);
      }
    }
    if (unknowns.length) {
      diags.unknownFacetValues[facetKey] = unknowns;
    }
  }

  return diags;
}

/** Calcule un écart budget pour le tie-break (plus petit = meilleur). */
function priceDeltaToBudget(item: CatalogItem, budget?: number | null): number {
  const p = typeof item.price_eur === "number" ? item.price_eur : Infinity;
  if (typeof budget !== "number" || Number.isNaN(budget)) return Number.POSITIVE_INFINITY;
  return Math.abs(p - budget);
}

export function recommendProducts(input: RecommendInput) {
  const {
    domainId,
    filters = {},
    budget_eur,
    pack,
    limit: rawLimit = 10,
  } = input;

  const limit = Math.max(1, Math.min(50, rawLimit | 0)); // borne 1..50
  const cat = loadCatalog(domainId);

  if (!cat.items.length) {
    return {
      ok: false,
      domainId,
      reason: "empty_catalog",
      items: [] as CatalogItem[],
      diagnostics: computeDiagnostics(filters, pack),
      total: 0,
      limitUsed: limit,
      catalogSource: cat.source,
    };
  }

  const diagnostics = computeDiagnostics(filters, pack);

  // Scoring: +1 par facette satisfaite; +0.5 si prix <= budget
  const scoreOnce = (respectBudgetStrict: boolean) => {
    const scored = cat.items.map((it) => {
      const { matched, totalAsked } = matchFacets(it, filters, pack);
      let score = matched;

      let priceOk = true;
      if (typeof budget_eur === "number" && !Number.isNaN(budget_eur)) {
        if (typeof it.price_eur === "number") {
          if (it.price_eur <= budget_eur) {
            score += 0.5; // bonus si on respecte le budget
          } else {
            priceOk = false;
          }
        }
      }

      return {
        item: it,
        score,
        matched,
        totalAsked,
        priceOk,
        deltaToBudget: priceDeltaToBudget(it, budget_eur),
      };
    });

    // Filtrage
    let filtered = scored.filter((s) => {
      const mustMatch =
        Object.keys(filters || {}).length > 0 ? s.matched > 0 : true;
      const budgetOK =
        typeof budget_eur === "number" && !Number.isNaN(budget_eur)
          ? s.priceOk || !respectBudgetStrict
          : true;
      return mustMatch && budgetOK;
    });

    // Tri: score desc, puis écart au budget asc, puis prix asc, puis nom asc
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.deltaToBudget !== b.deltaToBudget)
        return a.deltaToBudget - b.deltaToBudget;
      const pa =
        typeof a.item.price_eur === "number" ? a.item.price_eur : Infinity;
      const pb =
        typeof b.item.price_eur === "number" ? b.item.price_eur : Infinity;
      if (pa !== pb) return pa - pb;
      return (a.item.name || "").localeCompare(b.item.name || "");
    });

    return filtered;
  };

  // 1) Essai strict: respecter budget si fourni
  let filtered = scoreOnce(true);

  // 2) Si rien et budget fourni, on relâche le budget (on garde l’info)
  let budgetRelaxed = false;
  if (
    filtered.length === 0 &&
    typeof budget_eur === "number" &&
    !Number.isNaN(budget_eur)
  ) {
    filtered = scoreOnce(false);
    budgetRelaxed = true;
  }

  const items = filtered.slice(0, limit).map((s) => s.item);

  if (items.length === 0) {
    return {
      ok: false,
      domainId,
      reason: "no_match",
      criteria: { filters, budget_eur },
      diagnostics,
      total: 0,
      items: [],
      budgetRelaxed,
      limitUsed: limit,
      catalogSource: cat.source,
    };
  }

  return {
    ok: true,
    domainId,
    criteria: { filters, budget_eur },
    diagnostics,
    total: filtered.length,
    items,
    debug: filtered.slice(0, limit).map(({ item, score, matched, totalAsked, deltaToBudget }) => ({
      sku: item.sku,
      score,
      matched,
      totalAsked,
      deltaToBudget,
    })),
    budgetRelaxed,
    limitUsed: limit,
    catalogSource: cat.source,
  };
}