import { defineConfig } from 'genkit';

export default defineConfig({
  // On déclare nos flows dans src
  flows: ['./src/flows/**/*.ts'],
  plugins: [], // pas de plugins pour l’instant
});
