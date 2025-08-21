// src/flows/questions-top.ts
import { defineFlow } from "@genkit-ai/flow";
import { z } from "zod";

// Schémas (identiques)
export const InputSchema = z.object({
  event: z.string().default("User Question"),
  property: z.string().default("question"),
  days: z.number().int().positive().default(30),
  top: z.number().int().positive().default(10),
});
export type Input = z.infer<typeof InputSchema>;

export const OutputSchema = z.object({
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
export type Output = z.infer<typeof OutputSchema>;

// Implémentation unique: Mixpanel
import { questionsTopHandlerMP } from "./questions-top-mp";

export async function questionsTopHandler(input: Input): Promise<Output> {
  return questionsTopHandlerMP(input);
}

const questionsTop = defineFlow(
  {
    name: "questionsTop",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
  },
  async (input) => questionsTopHandler(input)
);

export default questionsTop;
export { questionsTop };