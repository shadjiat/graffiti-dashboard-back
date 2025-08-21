// src/ai/summarize.ts
import { GenerativeModel } from "@google/generative-ai";

export async function summarizeTimeseries(data: any): Promise<string> {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) return "⚠️ Pas de GOOGLE_API_KEY configurée.";

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || "gemini-1.5-flash",
    });

    const prompt = `
Tu es un analyste produit. Voici une série temporelle des performances de CTA.
Résume les différences principales en français clair, par exemple :
- Quel CTA a le mieux performé ?
- Sur quels jours y a-t-il des pics ?
- Quelle tendance générale se dégage ?

Données:
${JSON.stringify(data, null, 2)}
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err: any) {
    console.error("summarizeTimeseries error:", err);
    return "Erreur lors de l'analyse textuelle.";
  }
}