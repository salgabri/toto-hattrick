import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { getRequestToken, getAccessToken, type TokenPair } from '../chpp/auth.js';

/**
 * OAuth 1.0a flow endpoints. Secrets never leave the server; the browser only ever
 * gets the authorize URL and, at the end, a success flag.
 *
 * Request-token secrets are held in memory between step 1 and step 3. Fine for a
 * single-user dev flow; back this with a short-lived store if you go multi-user.
 */
const pending = new Map<string, TokenPair>();

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Step 1: begin authorization. Open the returned URL in a browser, approve, get a verifier.
  app.post('/api/auth/start', async () => {
    const { requestToken, authorizeUrl } = await getRequestToken();
    pending.set(requestToken.token, requestToken);
    return { authorizeUrl, requestToken: requestToken.token };
  });

  // Step 3: finish authorization with the verifier (PIN for "oob", or callback param).
  app.post<{ Body: { requestToken: string; verifier: string; userId?: number } }>(
    '/api/auth/finish',
    async (req, reply) => {
      const { requestToken: rtToken, verifier, userId } = req.body;
      const rt = pending.get(rtToken);
      if (!rt) return reply.code(400).send({ error: 'unknown or expired request token' });

      const access = await getAccessToken(rt, verifier);
      pending.delete(rtToken);

      // TODO: resolve the real Hattrick userId (e.g. a `file=check`/manager call) instead of
      // requiring it in the body. Until then the caller supplies it.
      const id = userId ?? 0;
      await prisma.chppToken.upsert({
        where: { userId: id },
        update: { accessToken: access.token, tokenSecret: access.tokenSecret },
        create: { userId: id, accessToken: access.token, tokenSecret: access.tokenSecret },
      });

      return { ok: true, userId: id };
    },
  );
}
