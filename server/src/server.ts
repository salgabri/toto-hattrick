import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { disconnectDb } from './db/client.js';
import { registerReadRoutes } from './routes/read.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSyncRoutes } from './routes/sync.js';

async function main() {
  const app = Fastify({ logger: true });

  // The frontend (Vite dev server) calls these JSON endpoints cross-origin.
  await app.register(cors, { origin: env.WEB_ORIGIN });

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerSyncRoutes(app);
  await registerReadRoutes(app);

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
