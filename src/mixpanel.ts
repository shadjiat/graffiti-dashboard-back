// src/mixpanel.ts
import fetch from "node-fetch";

const PROJECT_ID = process.env.MIXPANEL_PROJECT_ID;
const SERVICE_ACCOUNT = process.env.MIXPANEL_SERVICE_ACCOUNT;
const SECRET = process.env.MIXPANEL_SECRET;

if (!PROJECT_ID || !SERVICE_ACCOUNT || !SECRET) {
  throw new Error(
    "Missing Mixpanel env (MIXPANEL_PROJECT_ID, MIXPANEL_SERVICE_ACCOUNT, MIXPANEL_SECRET)."
  );
}

// Si rien n’est défini, on suppose l’hébergement EU.
const API_HOST = (process.env.MIXPANEL_API_HOST ?? "").trim() || "https://api-eu.mixpanel.com";

type JqlParams = Record<string, any>;

export async function jql<T>(script: string, params: JqlParams = {}): Promise<T> {
  const bodyParams = new URLSearchParams();
  bodyParams.set("script", script);
  bodyParams.set("params", JSON.stringify(params));
  bodyParams.set("project", PROJECT_ID?.toString() ?? "");

  const url = `${API_HOST}/api/2.0/jql`;

  // Align auth with Mixpanel best practices: service account + secret.
  const auth = Buffer.from(`${SERVICE_ACCOUNT}:${SECRET}`).toString("base64");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: bodyParams,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Mixpanel JQL error: ${res.status} ${res.statusText} – ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // Mixpanel peut renvoyer une string JSON par ligne
    const lines = text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return lines as unknown as T;
  }
}

export default { jql };