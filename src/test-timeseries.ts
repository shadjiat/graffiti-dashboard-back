import "dotenv/config";
import { runFlow } from "@genkit-ai/flow";
import ctaTimeseries from "./flows/cta-timeseries";

async function main() {
  const input = {
    event: "User Authenticated",
    property: "appClipParameterR",
    days: 30,
    top: 5,
    granularity: "day" as const,
  };

  console.log("▶ Running ctaTimeseries with input:", input);

  const result = await runFlow(ctaTimeseries, input);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("❌ Flow run error:", err);
  process.exit(1);
});