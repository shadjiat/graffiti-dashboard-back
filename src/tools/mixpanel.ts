// src/tools/mixpanel.ts
import 'dotenv/config';
import { fetch } from 'undici';

/**
 * Hôte API (EU par défaut ; mets MIXPANEL_HOST=https://api.mixpanel.com pour US)
 */
const MIXPANEL_HOST = process.env.MIXPANEL_HOST ?? 'https://eu.mixpanel.com';

/**
 * Identifiants (depuis .env, NE PAS committer ce fichier)
 */
const PROJECT_ID = process.env.MIXPANEL_PROJECT_ID!;
const SERVICE_ACCOUNT = process.env.MIXPANEL_SERVICE_ACCOUNT!;
const SERVICE_SECRET = process.env.MIXPANEL_SECRET!;

if (!PROJECT_ID || !SERVICE_ACCOUNT || !SERVICE_SECRET) {
  throw new Error(
    'Missing Mixpanel env vars: set MIXPANEL_PROJECT_ID, MIXPANEL_SERVICE_ACCOUNT, MIXPANEL_SECRET in .env'
  );
}

/** Types utilitaires */
export type DateRange = { from: string; to: string };

function b64(s: string) {
  return Buffer.from(s).toString('base64');
}

/** Appelle l’API JQL de Mixpanel et retourne le JSON */
async function jql<T = unknown>(script: string, params: Record<string, unknown>): Promise<T> {
  const url = `${MIXPANEL_HOST}/api/2.0/jql?project_id=${encodeURIComponent(PROJECT_ID)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${b64(`${SERVICE_ACCOUNT}:${SERVICE_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      script,
      params: JSON.stringify(params),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mixpanel JQL error: ${res.status} ${res.statusText} – ${text}`);
  }

  return (await res.json()) as T;
}

/**
 * Compte les occurrences d’un évènement dans une période (optionnellement filtré côté JQL).
 * where est une chaîne JS évaluée dans JQL (ex: "ev.properties.cta_id === 'cta02'")
 */
export async function getCtaClicksCount(
  eventName: string,
  range: DateRange,
  where?: string
): Promise<number> {
  const script = `
function main() {
  var data = Events({
    from_date: params.from,
    to_date: params.to,
    event_selectors: [{ event: params.event }]
  })
  ${where ? `.filter(function(ev){ return ${where}; })` : ''}
  .reduce(mixpanel.reducer.count());
  return data;
}
`.trim();

  const data = await jql<number | number[] | Array<{ count?: number }>>(script, {
    event: eventName,
    from: range.from,
    to: range.to,
  });

  if (typeof data === 'number') return data;
  if (Array.isArray(data) && data.length > 0) {
    const v = data[0] as any;
    if (typeof v === 'number') return v;
    if (v && typeof v.count === 'number') return v.count;
  }
  return 0;
}

/**
 * Groupe par valeur d’une propriété (paramètre) et compte les évènements.
 * Ex: property = "appClipParameterR" → [{ value: "cta02", count: 25 }, ...] trié desc.
 * where optionnel (ex: "ev.properties.user_type === 'authenticated'")
 */
export async function getEventCountsByProperty(
  eventName: string,
  range: DateRange,
  property: string,
  where?: string
): Promise<Array<{ value: string; count: number }>> {
  const script = `
function main() {
  var stream = Events({
    from_date: params.from,
    to_date: params.to,
    event_selectors: [{ event: params.event }]
  })
  ${where ? `.filter(function(ev){ return ${where}; })` : ''}
  .groupBy([function(ev){ return ev.properties[params.prop]; }], mixpanel.reducer.count())
  .map(function(item){
    return { value: item.key[0], count: item.value };
  });

  return stream;
}
`.trim();

  const data = await jql<Array<{ value: any; count: any }>>(script, {
    event: eventName,
    from: range.from,
    to: range.to,
    prop: property,
  });

  const rows = (Array.isArray(data) ? data : [])
    .map((r) => ({
      value: r?.value ?? null,
      count: typeof r?.count === 'number' ? r.count : Number(r?.count ?? 0),
    }))
    .filter((r) => r.value !== null && r.value !== '')
    .sort((a, b) => b.count - a.count);

  return rows;
}