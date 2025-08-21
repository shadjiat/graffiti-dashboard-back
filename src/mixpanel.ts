// src/mixpanel.ts
import fetch from "node-fetch";

const PROJECT_ID = process.env.MIXPANEL_PROJECT_ID;
const SERVICE_ACCOUNT = process.env.MIXPANEL_SERVICE_ACCOUNT;
const SECRET = process.env.MIXPANEL_SECRET;

// Si rien n’est défini, on suppose l’hébergement EU.
const API_HOST = (process.env.MIXPANEL_API_HOST ?? "").trim() || "https://api-eu.mixpanel.com";

type JqlParams = Record<string, any>;

export async function jql<T>(script: string, params: JqlParams = {}): Promise<T> {
  const bodyParams = new URLSearchParams();
  bodyParams.set("script", script);
  bodyParams.set("params", JSON.stringify(params));
  bodyParams.set("project", PROJECT_ID?.toString() ?? "");

  // === DIAGNOSTIC ===
  console.log("mixpanel.ts] DIAG --- PROJECT_ID:", PROJECT_ID ?? "(undefined)");
  console.log("mixpanel.ts] DIAG --- API_HOST:", API_HOST);
  const url = `${API_HOST}/api/2.0/jql`;
  console.log("mixpanel.ts] DIAG --- URL appelée:", url);

  // Pour JQL : Basic Auth avec uniquement l’API Secret en username
  const auth = Buffer.from(`${SECRET}:`).toString("base64");

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