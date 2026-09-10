import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';

// Validate the wire value before Number/Prisma can truncate a fraction, accept an alternate
// numeric spelling, or turn malformed input into an internal database error.
const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const leaderboardQuery = z.object({
  nationality: z.string().optional(),
  limit: positiveInteger.default('50'),
});

function readId(value: unknown, name: string, reply: FastifyReply): number | null {
  const parsed = positiveInteger.safeParse(value);
  if (parsed.success) return parsed.data;
  reply.code(400).send({ error: 'invalid parameter', message: `${name} must be a positive safe decimal integer` });
  return null;
}

const knownTeamId = (id: number): number | null => id > 0 ? id : null;
const missingTeamId = (id: number, field = 'championTeamId'): string[] => id > 0 ? [] : [field];

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
  app.get<{ Params: { season: string } }>('/api/seasons/:season/matches', async (req, reply) => {
    const season = readId(req.params.season, 'season', reply);
    if (season === null) return reply;
    return prisma.match.findMany({
      where: { season },
      orderBy: { matchDate: 'asc' },
    });
  });

  // Full detail for one match.
  app.get<{ Params: { matchId: string } }>('/api/matches/:matchId', async (req, reply) => {
    const matchId = readId(req.params.matchId, 'matchId', reply);
    if (matchId === null) return reply;
    const match = await prisma.match.findUnique({
      where: { matchId },
      include: { detail: true },
    });
    if (!match) return reply.code(404).send({ error: 'match not found' });
    return match;
  });

  // Per-season W/D/L + goals for/against for a team.
  app.get<{ Params: { teamId: string } }>('/api/teams/:teamId/summary', async (req, reply) => {
    const teamId = readId(req.params.teamId, 'teamId', reply);
    if (teamId === null) return reply;
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

  // League champion for each season of the team's existence.
  app.get('/api/champions', async () => {
    const rows = await prisma.seasonStanding.findMany({ orderBy: { season: 'desc' } });
    return rows.map((r) => ({
      season: r.season,
      league: r.leagueLevelUnitName,
      championTeamId: knownTeamId(r.championTeamId),
      champion: r.championTeamName,
      complete: r.complete, // false → season still running, champion is the current leader
      missingData: missingTeamId(r.championTeamId),
    }));
  });

  // Full reconstructed league table for one season.
  app.get<{ Params: { season: string } }>('/api/seasons/:season/standings', async (req, reply) => {
    const season = readId(req.params.season, 'season', reply);
    if (season === null) return reply;
    const row = await prisma.seasonStanding.findFirst({ where: { season } });
    if (!row) return reply.code(404).send({ error: 'no standings for that season' });
    return {
      season: row.season,
      league: row.leagueLevelUnitName,
      complete: row.complete,
      table: JSON.parse(row.standingsJson),
    };
  });

  // --- National top-division champions (every country, every season) -------------------

  // Countries we have a top division seeded for, with how many seasons of champions are stored.
  app.get('/api/national/leagues', async () => {
    const leagues = await prisma.nationalLeague.findMany({ where: { isCountry: true }, orderBy: { countryName: 'asc' } });
    const counts = await prisma.leagueChampion.groupBy({ by: ['leagueId'], _count: { _all: true } });
    const byId = new Map(counts.map((c) => [c.leagueId, c._count._all]));
    return leagues.map((l) => ({
      leagueId: l.leagueId,
      country: l.countryName,
      topSeriesId: l.topSeriesId,
      currentSeason: l.currentSeason,
      seasonsStored: byId.get(l.leagueId) ?? 0,
    }));
  });

  // Every season's champion for one country.
  app.get<{ Params: { leagueId: string } }>('/api/national/leagues/:leagueId/champions', async (req, reply) => {
    const leagueId = readId(req.params.leagueId, 'leagueId', reply);
    if (leagueId === null) return reply;
    const rows = await prisma.leagueChampion.findMany({ where: { leagueId }, orderBy: { season: 'desc' } });
    return rows.map((c) => {
      // Reconstruction from the winner-only bake uses 0/0 for facts it did not retain.
      // A completed league with no games is unknown; an unstarted current league and
      // genuine zero points after games have been played still retain numeric zeroes.
      const missingStatistics = c.complete && c.played === 0 && c.points === 0;
      return {
        season: c.season,
        championTeamId: knownTeamId(c.championTeamId),
        champion: c.championTeamName,
        championUserId: c.championUserId,
        championUserName: c.championUserName,
        points: missingStatistics ? null : c.points,
        played: missingStatistics ? null : c.played,
        complete: c.complete,
        missingData: [...missingTeamId(c.championTeamId), ...(missingStatistics ? ['points', 'played'] : [])],
      };
    });
  });

  // Champions across all countries for a single season.
  app.get<{ Params: { season: string } }>('/api/national/seasons/:season', async (req, reply) => {
    const season = readId(req.params.season, 'season', reply);
    if (season === null) return reply;
    const rows = await prisma.leagueChampion.findMany({ where: { season }, orderBy: { countryName: 'asc' } });
    return rows.map((c) => ({
      leagueId: c.leagueId,
      country: c.countryName,
      season: c.season,
      championTeamId: knownTeamId(c.championTeamId),
      champion: c.championTeamName,
      complete: c.complete,
      missingData: missingTeamId(c.championTeamId),
    }));
  });

  // --- Managers / users -----------------------------------------------------------------

  // Distinct manager nationalities (for the leaderboard filter), with how many managers each has.
  app.get('/api/users/nationalities', async () => {
    const rows = await prisma.hattrickUser.groupBy({ by: ['nationality'], _count: { _all: true }, orderBy: { _count: { nationality: 'desc' } } });
    return rows.filter((r) => r.nationality && r.nationality !== 'Unknown').map((r) => ({ nationality: r.nationality, managers: r._count._all }));
  });

  // Most title-winning managers. Counts FINISHED titles only (complete=true). Optional ?nationality=.
  app.get<{ Querystring: { nationality?: string; limit?: string } }>('/api/users/leaderboard', async (req, reply) => {
    const parsed = leaderboardQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({
      error: 'invalid query',
      message: 'limit must be a positive safe decimal integer; nationality must be a single string',
    });
    const take = Math.min(parsed.data.limit, 200);
    const where: Record<string, unknown> = { complete: true, championUserId: { gt: 0 } };
    if (parsed.data.nationality) {
      const ids = (await prisma.hattrickUser.findMany({ where: { nationality: parsed.data.nationality }, select: { userId: true } })).map((u) => u.userId);
      where.championUserId = { in: ids };
    }
    const grouped = await prisma.leagueChampion.groupBy({
      by: ['championUserId'],
      where,
      _count: { _all: true },
      orderBy: { _count: { championUserId: 'desc' } },
      take,
    });
    const ids = grouped.map((g) => g.championUserId).filter((x): x is number => x != null);
    const users = await prisma.hattrickUser.findMany({ where: { userId: { in: ids } } });
    const byId = new Map(users.map((u) => [u.userId, u]));
    return grouped.map((g) => ({
      userId: g.championUserId,
      userName: byId.get(g.championUserId!)?.loginName ?? `user ${g.championUserId}`,
      nationality: byId.get(g.championUserId!)?.nationality ?? null,
      titles: g._count._all,
    }));
  });

  // One manager + the list of titles they won.
  app.get<{ Params: { userId: string } }>('/api/users/:userId', async (req, reply) => {
    const userId = readId(req.params.userId, 'userId', reply);
    if (userId === null) return reply;
    const user = await prisma.hattrickUser.findUnique({ where: { userId } });
    if (!user) return reply.code(404).send({ error: 'user not found' });
    const titles = await prisma.leagueChampion.findMany({
      where: { championUserId: userId },
      orderBy: [{ complete: 'desc' }, { season: 'desc' }],
    });
    return {
      userId: user.userId,
      userName: user.loginName,
      nationality: user.nationality,
      titles: titles.map((t) => ({
        country: t.countryName,
        season: t.season,
        club: t.championTeamName,
        clubId: knownTeamId(t.championTeamId),
        complete: t.complete,
        missingData: missingTeamId(t.championTeamId, 'clubId'),
      })),
    };
  });
}
