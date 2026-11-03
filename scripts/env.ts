import { existsSync } from 'node:fs';

// Loads .env.local and .env from the repo root, then apps/web/.env.local, where `vercel env pull`
// writes when run in the linked app. No file overrides a variable that is already set, so earlier
// files win over later ones and the shell wins over all of them. Imported first, before anything
// reads the environment.
for (const file of ['.env.local', '.env', 'apps/web/.env.local']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
