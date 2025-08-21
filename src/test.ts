// src/test-timeseries.ts
// ASCII only test runner.

import "dotenv/config";
import { ctaTimeseries } from "./flows";

async function main() {
  console.log("Running ctaTimeseries test...");

  const input = {
    query: "Top CTAs over 30 days",
    event: "User Authenticated",
    property: "appClipParameterR",
    days: 30,
    top: 5,
    granularity: "day" as const,
  };

  try {
    const res = await ctaTimeseries(input);
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

main();