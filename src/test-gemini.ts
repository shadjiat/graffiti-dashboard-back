import { routeWithGemini } from "./ai/gemini";

(async () => {
  const q = "Compare les performances de cta01 et cta02 sur les 7 derniers jours";
  try {
    const out = await routeWithGemini(q);
    console.log("Gemini OK:", out);
  } catch (err) {
    console.error("Gemini FAIL:", err);
  }
})();