import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { disconnectDb } from './db/client.js';
import { registerReadRoutes } from './routes/read.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerScrapeRoutes } from './routes/scrape.js';

async function main() {
  const app = Fastify({ logger: true });

  // Reflect any origin in dev: the frontend AND the user's logged-in Hattrick browser tab
  // (which drives the history scrape) both call these endpoints cross-origin.
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerSyncRoutes(app);
  await registerReadRoutes(app);
  await registerScrapeRoutes(app);

  const shutdown = async () => {
    await app.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
