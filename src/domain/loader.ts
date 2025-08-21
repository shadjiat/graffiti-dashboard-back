// src/domain/loader.ts
import * as path from "node:path";
import * as fs from "node:fs";
import { DomainPackSchema, DomainPack } from "./schema";

/** Merge profond minimal, spécifique à notre structure. */
function deepMerge<T extends Record<string, any>>(base: T, overlay: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay || {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof (base as any)[k] === "object" && !Array.isArray((base as any)[k])) {
      out[k] = deepMerge((base as any)[k], v as any);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Cherche un overlay par priorité :
 *  1) data/domains/<tenantId>/<domain>.overlay.json
 *  2) data/domains/<domain>.overlay.json
 *  3) src/domain/<domain>.overlay.json (fallback dev)
 */
function findOverlayPath(domain: string, tenantId?: string) {
  const candidates = [
    tenantId && path.resolve(process.cwd(), "data", "domains", tenantId, `${domain}.overlay.json`),
    path.resolve(process.cwd(), "data", "domains", `${domain}.overlay.json`),
    path.resolve(process.cwd(), "src", "domain", `${domain}.overlay.json`)
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Charge pack base + overlay (si présent) et renvoie un DomainPack validé.
 * - domain = "wine" (aujourd’hui)
 * - tenantId optionnel (client/magasin)
 */
export function loadDomainPack(domain: string, tenantId?: string): DomainPack {
  const basePath = path.resolve(process.cwd(), "src", "domain", `${domain}.base.json`);
  if (!fs.existsSync(basePath)) {
    throw new Error(`Base domain file not found: ${basePath}`);
  }
  const baseRaw = JSON.parse(fs.readFileSync(basePath, "utf-8"));

  const overlayPath = findOverlayPath(domain, tenantId);
  const overlayRaw = overlayPath ? JSON.parse(fs.readFileSync(overlayPath, "utf-8")) : {};

  const merged = deepMerge(baseRaw, overlayRaw);
  merged.meta = {
    ...(merged.meta || {}),
    source: overlayPath ? "merged" : "base",
    tenantId: tenantId || merged.meta?.tenantId,
    addedAt: merged.meta?.addedAt || new Date().toISOString()
  };

  const parsed = DomainPackSchema.parse(merged);
  return parsed;
}

/** Utilitaire simple (pour tests manuels) */
export function tryLoadWine(tenantId?: string) {
  return loadDomainPack("wine", tenantId);
}