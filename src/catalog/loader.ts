// src/catalog/loader.ts
import * as path from "node:path";
import * as fs from "node:fs";

export type CatalogItem = {
  sku: string;
  name: string;
  price_eur?: number;
  facets?: Record<string, any>;
};

export type Catalog = {
  ok: boolean;
  id: string;
  source: string;
  count: number;
  items: CatalogItem[];
};

function readJson(p: string): any {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

/** Charge un catalogue depuis data/catalogs/<id>.json (ou .sample.json en fallback). */
export function loadCatalog(id: string): Catalog {
  const baseDir = path.resolve(process.cwd(), "data", "catalogs");
  const primary = path.join(baseDir, `${id}.json`);
  const sample = path.join(baseDir, `${id}.sample.json`);

  let source = "demo_fallback";
  let items: CatalogItem[] = [];

  if (fs.existsSync(primary)) {
    const raw = readJson(primary);
    items = Array.isArray(raw.items) ? raw.items : [];
    source = primary;
  } else if (fs.existsSync(sample)) {
    const raw = readJson(sample);
    items = Array.isArray(raw.items) ? raw.items : [];
    source = sample;
  }

  return {
    ok: true,
    id,
    source,
    count: items.length,
    items,
  };
}