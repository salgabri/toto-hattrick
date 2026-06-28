import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { syncTeam } from '../sync/index.js';

/**
 * Manual sync trigger. The route is a thin shell — all sync logic lives in syncTeam()
 * so a scheduler can call the same function later.
 */
export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { teamId: string }; Querystring: { userId?: string } }>(
    '/api/sync/:teamId',
    async (req, reply) => {
      const teamId = Number(req.params.teamId);
      const userId = req.query.userId ? Number(req.query.userId) : 0;

      const stored = await prisma.chppToken.findUnique({ where: { userId } });
      if (!stored) {
        return reply.code(401).send({ error: 'no CHPP token — run the OAuth flow first' });
      }

      const result = await syncTeam(
        { token: stored.accessToken, tokenSecret: stored.tokenSecret },
        teamId,
      );
      return result;
    },
  );
}
