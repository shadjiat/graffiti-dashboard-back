// src/domain/schema.ts
import { z } from "zod";

/**
 * Schéma générique d’un pack domaine (versionné, validé).
 * - intents: mots-clés -> intention (ex: recommander, comparer, filtrer…)
 * - synonyms: alias -> canonique (ex: “bulleux” -> “petillant”)
 * - facets: liste de facettes autorisées et leur vocabulaire
 */
export const DomainPackSchema = z.object({
  domain: z.string(),               // "wine", "skincare", etc.
  version: z.string(),              // "1.0.0"
  language: z.string().default("fr"),
  intents: z.record(
    z.object({
      description: z.string().optional(),
      examples: z.array(z.string()).optional(),
      // Optionnel: contraintes associées à l’intent
      constraints: z.record(z.any()).optional(),
    })
  ).default({}),
  synonyms: z.record(z.string()).default({}), // alias -> canonical
  facets: z.record(
    z.object({
      description: z.string().optional(),
      values: z.array(z.string()).optional(), // vocabulaire contrôlé
      // Optionnel: mapping supplémentaire (alias valeur -> canonique valeur)
      valueSynonyms: z.record(z.string()).optional(),
    })
  ).default({}),
  // Éventuels regex/expressions spécifiques au domaine
  patterns: z.record(z.string()).default({}),
  // Métadonnées
  meta: z.object({
    source: z.enum(["base", "merged"]).default("base"),
    addedAt: z.string().optional(),
    tenantId: z.string().optional(),
    confidence: z.number().optional(),
  }).default({ source: "base" }),
});

export type DomainPack = z.infer<typeof DomainPackSchema>;