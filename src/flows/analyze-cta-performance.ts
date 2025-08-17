// src/flows/analyze-cta-performance.ts
import { z } from 'zod';
import { defineFlow } from '@genkit-ai/flow';
import { getEventCountsByProperty } from '../tools/mixpanel';

const InputSchema = z.object({
  question: z.string().default('Which CTA performed best?'),
  eventName: z.string().default('CTA Clicked'),               // nom EXACT de l’événement Mixpanel
  property: z.string().default('appClipParameterR'),          // propriété/paramètre à grouper
  range: z.object({
    from: z.string(), // YYYY-MM-DD
    to: z.string(),   // YYYY-MM-DD
  }),
  where: z.string().optional(), // ex: "ev.properties.user_type === 'authenticated'"
});

const OutputSchema = z.object({
  answer: z.string(),
  best: z.object({
    value: z.string(),
    count: z.number(),
  }).optional(),
  rows: z.array(z.object({ value: z.string(), count: z.number() })),
});

export const analyzeCtaPerformance = defineFlow(
  {
    name: 'analyzeCtaPerformance',
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => {
    // 1) Group by property dans Mixpanel
    const rows = await getEventCountsByProperty(
      input.eventName,
      input.range,
      input.property,
      input.where
    );

    // 2) Top 1
    const best = rows[0]
      ? { value: String(rows[0].value), count: rows[0].count }
      : undefined;

    // 3) Message lisible
    const answer = best
      ? `For "${input.question}", best ${input.property} is "${best.value}" with ${best.count} events.`
      : `For "${input.question}", no events found for ${input.eventName} in the given range.`;

    return { answer, best, rows };
  }
);