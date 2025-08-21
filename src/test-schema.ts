import { getSchema } from "./tools/mixpanel";

async function main() {
  try {
    console.log("Fetching schema...");
    const schema = await getSchema({ from: '2025-07-25', to: '2025-08-17' }); // limite à 10 résultats
    console.log("✅ Schema fetched successfully:");
    console.log(JSON.stringify(schema, null, 2));
  } catch (err) {
    console.error("❌ Error while fetching schema:", err);
  }
}

main();