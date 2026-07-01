import { z } from 'zod';

/**
 * Zod schemas for parsed CHPP XML — modelled against real captures in /server/samples
 * (teamdetails 3.6, matchesarchive 1.4, matchdetails 3.0). Field names come straight from
 * those files; do not add fields that aren't present in a sample.
 *
 * fast-xml-parser runs with parseTagValue:false, so every tag value arrives as a string and
 * attributes are prefixed `@_`. We coerce numbers here and convert HT date strings to Date.
 */

// --- helpers ----------------------------------------------------------------

/** CHPP dates look like "2026-03-31 19:00:00". Parse as UTC for deterministic season buckets. */
function htDate(s: string): Date {
  return new Date(`${s.replace(' ', 'T')}Z`);
}
const HtDate = z.string().min(1).transform(htDate);

/** A repeated XML element is an array when >1, an object when ==1, and missing/"" when 0. */
const arrayOf = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]),
    z.array(schema),
  );

const num = z.coerce.number();

// --- teamdetails (3.6) ------------------------------------------------------

const TeamDetailsTeam = z
  .object({
    TeamID: num,
    TeamName: z.string(),
    IsPrimaryClub: z.string().transform((s) => s === 'True'),
    FoundedDate: z.string().min(1).transform(htDate).nullish(),
    League: z.object({ LeagueID: num, LeagueName: z.string() }),
  })
  .passthrough();

const TeamDetailsSchema = z.object({
  HattrickData: z
    .object({
      UserID: num,
      Teams: z.object({ Team: arrayOf(TeamDetailsTeam) }),
    })
    .passthrough(),
});

export interface TeamSummary {
  teamId: number;
  name: string;
  isPrimary: boolean;
  foundedDate: Date | null;
  leagueId: number;
  leagueName: string;
}

export function parseTeamDetails(raw: unknown): { userId: number; teams: TeamSummary[] } {
  const d = TeamDetailsSchema.parse(raw).HattrickData;
  return {
    userId: d.UserID,
    teams: d.Teams.Team.map((t) => ({
      teamId: t.TeamID,
      name: t.TeamName,
      isPrimary: t.IsPrimaryClub,
      foundedDate: t.FoundedDate ?? null,
      leagueId: t.League.LeagueID,
      leagueName: t.League.LeagueName,
    })),
  };
}

// --- matchesarchive (1.4) ---------------------------------------------------

const ArchiveMatch = z
  .object({
    MatchID: num,
    HomeTeam: z.object({ HomeTeamID: num, HomeTeamName: z.string() }),
    AwayTeam: z.object({ AwayTeamID: num, AwayTeamName: z.string() }),
    MatchDate: HtDate,
    MatchType: num,
    MatchContextId: num.optional(),
    MatchRuleId: num.optional(),
    CupLevel: num.optional(),
    CupLevelIndex: num.optional(),
    HomeGoals: num.nullish(),
    AwayGoals: num.nullish(),
  })
  .passthrough();

const MatchesArchiveSchema = z.object({
  HattrickData: z
    .object({
      Team: z.object({
        TeamID: num,
        TeamName: z.string(),
        // MatchList is "" when the window holds no matches.
        MatchList: z
          .union([z.literal(''), z.object({ Match: arrayOf(ArchiveMatch) })])
          .transform((v) => (v === '' ? { Match: [] } : v)),
      }),
    })
    .passthrough(),
});

export interface ArchiveMatchSummary {
  matchId: number;
  matchDate: Date;
  matchType: number;
  /** For league matches (matchType 1) this is the LeagueLevelUnitID of the division. */
  matchContextId: number | null;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export function parseMatchesArchive(raw: unknown): {
  teamId: number;
  teamName: string;
  matches: ArchiveMatchSummary[];
} {
  const t = MatchesArchiveSchema.parse(raw).HattrickData.Team;
  return {
    teamId: t.TeamID,
    teamName: t.TeamName,
    matches: t.MatchList.Match.map((m) => ({
      matchId: m.MatchID,
      matchDate: m.MatchDate,
      matchType: m.MatchType,
      matchContextId: m.MatchContextId ?? null,
      homeTeamId: m.HomeTeam.HomeTeamID,
      homeTeamName: m.HomeTeam.HomeTeamName,
      awayTeamId: m.AwayTeam.AwayTeamID,
      awayTeamName: m.AwayTeam.AwayTeamName,
      homeGoals: m.HomeGoals ?? null,
      awayGoals: m.AwayGoals ?? null,
    })),
  };
}

// --- matchdetails (3.0) -----------------------------------------------------
// Team-level ratings/tactics/formation + scorers + possession. Per-player lineup is NOT in
// this file — it lives in `matchlineup` (a future enrichment); EventList only appears when
// the call passes matchEvents=true.

const Ratings = {
  RatingMidfield: num,
  RatingRightDef: num,
  RatingMidDef: num,
  RatingLeftDef: num,
  RatingRightAtt: num,
  RatingMidAtt: num,
  RatingLeftAtt: num,
  RatingIndirectSetPiecesDef: num.optional(),
  RatingIndirectSetPiecesAtt: num.optional(),
};
interface RatingFields {
  RatingMidfield: number;
  RatingRightDef: number;
  RatingMidDef: number;
  RatingLeftDef: number;
  RatingRightAtt: number;
  RatingMidAtt: number;
  RatingLeftAtt: number;
  RatingIndirectSetPiecesDef?: number;
  RatingIndirectSetPiecesAtt?: number;
}
const ratingsOf = (s: RatingFields) => ({
  midfield: s.RatingMidfield,
  rightDef: s.RatingRightDef,
  midDef: s.RatingMidDef,
  leftDef: s.RatingLeftDef,
  rightAtt: s.RatingRightAtt,
  midAtt: s.RatingMidAtt,
  leftAtt: s.RatingLeftAtt,
  setPiecesDef: s.RatingIndirectSetPiecesDef ?? null,
  setPiecesAtt: s.RatingIndirectSetPiecesAtt ?? null,
});

const HomeSide = z
  .object({
    HomeTeamID: num,
    HomeTeamName: z.string(),
    Formation: z.string().optional(),
    HomeGoals: num.nullish(),
    TacticType: num.optional(),
    TacticSkill: num.optional(),
    ...Ratings,
  })
  .passthrough();
const AwaySide = z
  .object({
    AwayTeamID: num,
    AwayTeamName: z.string(),
    Formation: z.string().optional(),
    AwayGoals: num.nullish(),
    TacticType: num.optional(),
    TacticSkill: num.optional(),
    ...Ratings,
  })
  .passthrough();

const Goal = z
  .object({
    ScorerPlayerID: num,
    ScorerPlayerName: z.string(),
    ScorerTeamID: num,
    ScorerHomeGoals: num,
    ScorerAwayGoals: num,
    ScorerMinute: num,
    MatchPart: num.optional(),
  })
  .passthrough();

const MatchDetailsSchema = z.object({
  HattrickData: z
    .object({
      Match: z
        .object({
          MatchID: num,
          MatchType: num,
          MatchDate: HtDate,
          FinishedDate: z.string().min(1).transform(htDate).nullish(),
          HomeTeam: HomeSide,
          AwayTeam: AwaySide,
          Scorers: z
            .union([z.literal(''), z.object({ Goal: arrayOf(Goal) })])
            .transform((v) => (v === '' ? { Goal: [] } : v)),
          PossessionFirstHalfHome: num.optional(),
          PossessionFirstHalfAway: num.optional(),
          PossessionSecondHalfHome: num.optional(),
          PossessionSecondHalfAway: num.optional(),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface MatchDetails {
  matchId: number;
  matchType: number;
  matchDate: Date;
  finishedDate: Date | null;
  lineup: unknown; // { home/away: { formation, tacticType, tacticSkill } }
  scorers: unknown; // Goal[]
  ratings: unknown; // { home, away, possession }
}

export function parseMatchDetails(raw: unknown): MatchDetails {
  const m = MatchDetailsSchema.parse(raw).HattrickData.Match;
  return {
    matchId: m.MatchID,
    matchType: m.MatchType,
    matchDate: m.MatchDate,
    finishedDate: m.FinishedDate ?? null,
    lineup: {
      home: { formation: m.HomeTeam.Formation, tacticType: m.HomeTeam.TacticType, tacticSkill: m.HomeTeam.TacticSkill },
      away: { formation: m.AwayTeam.Formation, tacticType: m.AwayTeam.TacticType, tacticSkill: m.AwayTeam.TacticSkill },
    },
    scorers: m.Scorers.Goal.map((g) => ({
      playerId: g.ScorerPlayerID,
      playerName: g.ScorerPlayerName,
      teamId: g.ScorerTeamID,
      homeGoals: g.ScorerHomeGoals,
      awayGoals: g.ScorerAwayGoals,
      minute: g.ScorerMinute,
      matchPart: g.MatchPart ?? null,
    })),
    ratings: {
      home: ratingsOf(m.HomeTeam),
      away: ratingsOf(m.AwayTeam),
      possession: {
        firstHalfHome: m.PossessionFirstHalfHome ?? null,
        firstHalfAway: m.PossessionFirstHalfAway ?? null,
        secondHalfHome: m.PossessionSecondHalfHome ?? null,
        secondHalfAway: m.PossessionSecondHalfAway ?? null,
      },
    },
  };
}

// --- leaguefixtures (1.2) ---------------------------------------------------
// All matches for one division (LeagueLevelUnitID) in a given season — including past
// seasons. Lets us reconstruct a final table and crown the champion. Goals are empty
// strings for rounds not yet played (current season).

/** Goal value: "" (unplayed) → null, otherwise a number. */
const goalOrNull = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.coerce.number().nullable(),
);

const FixtureMatch = z
  .object({
    MatchID: num,
    MatchRound: num,
    HomeTeam: z.object({ HomeTeamID: num, HomeTeamName: z.string() }),
    AwayTeam: z.object({ AwayTeamID: num, AwayTeamName: z.string() }),
    MatchDate: HtDate,
    HomeGoals: goalOrNull,
    AwayGoals: goalOrNull,
  })
  .passthrough();

const LeagueFixturesSchema = z.object({
  HattrickData: z
    .object({
      LeagueLevelUnitID: num,
      LeagueLevelUnitName: z.string(),
      Season: num,
      Match: arrayOf(FixtureMatch),
    })
    .passthrough(),
});

export interface FixtureResult {
  matchId: number;
  round: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export function parseLeagueFixtures(raw: unknown): {
  leagueLevelUnitId: number;
  leagueLevelUnitName: string;
  season: number;
  matches: FixtureResult[];
} {
  const d = LeagueFixturesSchema.parse(raw).HattrickData;
  return {
    leagueLevelUnitId: d.LeagueLevelUnitID,
    leagueLevelUnitName: d.LeagueLevelUnitName,
    season: d.Season,
    matches: d.Match.map((m) => ({
      matchId: m.MatchID,
      round: m.MatchRound,
      homeTeamId: m.HomeTeam.HomeTeamID,
      homeTeamName: m.HomeTeam.HomeTeamName,
      awayTeamId: m.AwayTeam.AwayTeamID,
      awayTeamName: m.AwayTeam.AwayTeamName,
      homeGoals: m.HomeGoals,
      awayGoals: m.AwayGoals,
    })),
  };
}
