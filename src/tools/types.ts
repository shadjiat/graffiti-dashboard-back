// Types communs pour les tools/flows

export type DateISO = `${number}-${number}-${number}`; // "YYYY-MM-DD"

export interface DateRange {
  from: DateISO;
  to: DateISO;
}

export interface CtaQuery {
  /** Nom d’événement Mixpanel (ex: "CTA Clicked") */
  eventName: string;
  /** Fenêtre temporelle */
  range: DateRange;
  /** Filtre optionnel (ex: { cta_id: "abc123", store_id: "paris-01" }) */
  where?: Record<string, string | number | boolean>;
}