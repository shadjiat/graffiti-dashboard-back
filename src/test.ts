import { runFlow } from '@genkit-ai/flow';
import { analyzeCtaPerformance } from './flows/analyze-cta-performance';

async function main() {
  const result = await runFlow(analyzeCtaPerformance, {
    question: 'Which CTA performed best?',
    eventName: 'User Authenticated', // << ton event exact
    property: 'appClipParameterR',                   // << ta propriété
    range: { from: '2025-07-25', to: '2025-08-17' }, // << ta période
    // where: "ev.properties.user_type === 'authenticated'", // optionnel
  });

  console.log('Flow result:', JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});