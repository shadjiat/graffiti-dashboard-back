import { defineFlow } from "@genkit-ai/flow";
import * as flows from "./flows";
import ctaTimeseries from "./flows/cta-timeseries";

console.log("typeof defineFlow =", typeof defineFlow);
console.log("typeof direct ctaTimeseries =", typeof ctaTimeseries);
console.log("keys from './flows' =", Object.keys(flows));
console.log("typeof flows.ctaTimeseries =", typeof (flows as any).ctaTimeseries);

// Affiche l'objet exporté pour inspection visuelle
console.log("inspect direct ctaTimeseries =", ctaTimeseries);
console.log("inspect flows.ctaTimeseries =", (flows as any).ctaTimeseries);
