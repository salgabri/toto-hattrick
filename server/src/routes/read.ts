import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';

/**
 * JSON read API. Serves the frontend from OUR DB only — never live Hattrick.
 * Safe to implement fully now: it does not depend on the XML schema.
 */
export async function registerReadRoutes(app: FastifyInstance): Promise<void> {
  // List of seasons we have data for (with a match count).
  app.get('/api/seasons', async () => {
    const rows = await prisma.match.groupBy({
      by: ['season'],
      _count: { _all: true },
      orderBy: { season: 'desc' },
    });
    return rows.map((r) => ({ season: r.season, matches: r._count._all }));
  });

  // Results in a season.
  app.get<{ Params: { season: string } }>('/api/seasons/:season/matches', async (req) => {
    const season = Number(req.params.season);
    return prisma.match.findMany({
      where: { season },
      orderBy: { matchDate: 'asc' },
    });
  });

  // Full detail for one match.
  app.get<{ Params: { matchId: string } }>('/api/matches/:matchId', async (req, reply) => {
    const matchId = Number(req.params.matchId);
    const match = await prisma.match.findUnique({
      where: { matchId },
      include: { detail: true },
    });
    if (!match) return reply.code(404).send({ error: 'match not found' });
    return match;
  });

  // Per-season W/D/L + goals for/against for a team.
  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/summary', async (req) => {
    const teamId = Number(req.params.teamId);
    const matches = await prisma.match.findMany({
      where: { teamId, homeGoals: { not: null }, awayGoals: { not: null } },
      orderBy: { season: 'desc' },
    });

    const bySeason = new Map<
      number,
      { season: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number }
    >();

    for (const m of matches) {
      const isHome = m.homeTeamId === teamId;
      const gf = (isHome ? m.homeGoals : m.awayGoals) ?? 0;
      const ga = (isHome ? m.awayGoals : m.homeGoals) ?? 0;

      const s = bySeason.get(m.season) ?? {
        season: m.season,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
      s.goalsFor += gf;
      s.goalsAgainst += ga;
      if (gf > ga) s.wins++;
      else if (gf < ga) s.losses++;
      else s.draws++;
      bySeason.set(m.season, s);
    }

    return [...bySeason.values()].sort((a, b) => b.season - a.season);
  });
}
