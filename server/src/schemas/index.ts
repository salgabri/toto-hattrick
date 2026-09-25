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

/** Goal value: "" (unplayed) or missing → null, otherwise a number. */
const goalOrNull = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : v),
  z.coerce.number().nullable(),
);

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
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
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
    homeTeamId: m.HomeTeam.HomeTeamID,
    homeTeamName: m.HomeTeam.HomeTeamName,
    awayTeamId: m.AwayTeam.AwayTeamID,
    awayTeamName: m.AwayTeam.AwayTeamName,
    homeGoals: m.HomeTeam.HomeGoals ?? null,
    awayGoals: m.AwayTeam.AwayGoals ?? null,
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

// --- worlddetails (1.9) Cups ------------------------------------------------
// One League with its Cups catalog. We only need the cup identity + level so the seed can
// classify main (CupLevel 1) vs secondary (CupLevel 2/3) national-level cups (CupLeagueLevel 0).

const WorldCup = z
  .object({
    CupID: num,
    CupName: z.string(),
    CupLeagueLevel: num,
    CupLevel: num,
    CupLevelIndex: num,
    MatchRound: num.optional(),
    MatchRoundsLeft: num.optional(),
  })
  .passthrough();

const WorldDetailsSchema = z.object({
  HattrickData: z
    .object({
      LeagueList: z.object({
        League: z
          .object({
            LeagueID: num,
            LeagueName: z.string(),
            EnglishName: z.string().optional(),
            Season: num,
            SeasonOffset: num.optional(),
            MatchRound: num.optional(),
            CupMatchDate: HtDate.optional(),
            SeriesMatchDate: HtDate.optional(),
            Cups: z
              .union([z.literal(''), z.object({ Cup: arrayOf(WorldCup) })])
              .transform((v) => (v === '' ? { Cup: [] } : v)),
          })
          .passthrough(),
      }),
    })
    .passthrough(),
});

export interface WorldCupInfo {
  cupId: number;
  cupName: string;
  cupLeagueLevel: number;
  cupLevel: number;
  cupLevelIndex: number;
  matchRound: number | null;
  matchRoundsLeft: number | null;
}

export function parseWorldDetailsCups(raw: unknown): {
  leagueId: number;
  leagueName: string;
  englishName: string | null;
  currentSeason: number;
  seasonOffset: number | null;
  matchRound: number | null;
  cupMatchDate: Date | null;
  seriesMatchDate: Date | null;
  cups: WorldCupInfo[];
} {
  const l = WorldDetailsSchema.parse(raw).HattrickData.LeagueList.League;
  return {
    leagueId: l.LeagueID,
    leagueName: l.LeagueName,
    englishName: l.EnglishName ?? null,
    currentSeason: l.Season,
    seasonOffset: l.SeasonOffset ?? null,
    matchRound: l.MatchRound ?? null,
    cupMatchDate: l.CupMatchDate ?? null,
    seriesMatchDate: l.SeriesMatchDate ?? null,
    cups: l.Cups.Cup.map((c) => ({
      cupId: c.CupID,
      cupName: c.CupName,
      cupLeagueLevel: c.CupLeagueLevel,
      cupLevel: c.CupLevel,
      cupLevelIndex: c.CupLevelIndex,
      matchRound: c.MatchRound ?? null,
      matchRoundsLeft: c.MatchRoundsLeft ?? null,
    })),
  };
}

// --- cupmatches (1.2) -------------------------------------------------------
// Matches of one cup round. With no cupRound we get the LAST played round; for a finished cup
// that is the single-match final → the winner. Goals only exist when MatchResult Available=True.
// Team ids are NOT in this file (names only) — resolve them from matchdetails on the final.

const CupMatchResult = z
  .object({
    '@_Available': z.string().optional(),
    HomeGoals: goalOrNull.optional(),
    AwayGoals: goalOrNull.optional(),
  })
  .passthrough();

const CupMatch = z
  .object({
    MatchID: num,
    MatchDate: HtDate,
    HomeTeamName: z.string(),
    AwayTeamName: z.string(),
    MatchResult: z.union([z.literal(''), CupMatchResult]).transform((v) => (v === '' ? {} : v)),
  })
  .passthrough();

const CupMatchesSchema = z.object({
  HattrickData: z
    .object({
      Cup: z
        .object({
          CupID: num,
          CupName: z.string(),
          CupSeason: num,
          CupRound: num,
          Match: z
            .union([z.literal(''), arrayOf(CupMatch)])
            .transform((v) => (v === '' ? [] : v)),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface CupMatchResultRow {
  matchId: number;
  matchDate: Date;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export function parseCupMatches(raw: unknown): {
  cupId: number;
  cupName: string;
  season: number;
  round: number;
  matches: CupMatchResultRow[];
} {
  const c = CupMatchesSchema.parse(raw).HattrickData.Cup;
  return {
    cupId: c.CupID,
    cupName: c.CupName,
    season: c.CupSeason,
    round: c.CupRound,
    matches: c.Match.map((m) => ({
      matchId: m.MatchID,
      matchDate: m.MatchDate,
      homeTeamName: m.HomeTeamName,
      awayTeamName: m.AwayTeamName,
      homeGoals: m.MatchResult.HomeGoals ?? null,
      awayGoals: m.MatchResult.AwayGoals ?? null,
    })),
  };
}

// --- leaguefixtures (1.2) ---------------------------------------------------
// All matches for one division (LeagueLevelUnitID) in a given season — including past
// seasons. Lets us reconstruct a final table and crown the champion. Goals are empty
// strings for rounds not yet played (current season). (goalOrNull is defined up top.)

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

// --- tournamentdetails (1.0) -----------------------------------------------
// Current tournament metadata. The field casing below is taken from the authenticated
// tournamentdetails-1.0 captures in /server/samples.

const TournamentDetailsSchema = z.object({
  HattrickData: z
    .object({
      FileName: z.literal('tournamentdetails.xml'),
      Version: z.literal('1.0'),
      Tournament: z
        .object({
          TournamentId: num,
          Name: z.string(),
          Season: num,
          LastMatchRound: num,
          FirstMatchRoundDate: HtDate,
          NextMatchRoundDate: HtDate,
          // Retained CHPP tournamentdetails (U21 Africa Cup, 2026-09-25) uses -1 for true.
          IsMatchesOngoing: z.enum(['0', '1', '-1']).transform((value) => value !== '0'),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface TournamentDetailsSummary {
  tournamentId: number;
  name: string;
  season: number;
  lastMatchRound: number;
  firstMatchRoundDate: Date;
  nextMatchRoundDate: Date;
  isMatchesOngoing: boolean;
}

export function parseTournamentDetails(raw: unknown): TournamentDetailsSummary {
  const tournament = TournamentDetailsSchema.parse(raw).HattrickData.Tournament;
  return {
    tournamentId: tournament.TournamentId,
    name: tournament.Name,
    season: tournament.Season,
    lastMatchRound: tournament.LastMatchRound,
    firstMatchRoundDate: tournament.FirstMatchRoundDate,
    nextMatchRoundDate: tournament.NextMatchRoundDate,
    isMatchesOngoing: tournament.IsMatchesOngoing,
  };
}

// --- tournamentfixtures (1.1) ----------------------------------------------
// The endpoint returns one flat Match list. A self-closing <Matches /> is an empty string after
// fast-xml-parser, so normalize that real response shape to an empty array.

const TournamentFixture = z
  .object({
    MatchId: num,
    HomeTeamId: num,
    HomeTeamName: z.string(),
    AwayTeamId: num,
    AwayTeamName: z.string(),
    MatchDate: HtDate,
    MatchType: num,
    MatchRound: num,
    Group: num,
    Status: num,
    HomeGoals: num,
    AwayGoals: num,
  })
  .passthrough();

const TournamentFixturesSchema = z.object({
  HattrickData: z
    .object({
      FileName: z.literal('tournamentFixtures.xml'),
      Version: z.literal('1.1'),
      Matches: z
        .union([z.literal(''), z.object({ Match: arrayOf(TournamentFixture) }).passthrough()])
        .transform((value) => (value === '' ? { Match: [] } : value)),
    })
    .passthrough(),
});

export interface TournamentFixtureResult {
  matchId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  matchDate: Date;
  matchType: number;
  round: number;
  group: number;
  status: number;
  homeGoals: number;
  awayGoals: number;
}

export function parseTournamentFixtures(raw: unknown): { matches: TournamentFixtureResult[] } {
  const matches = TournamentFixturesSchema.parse(raw).HattrickData.Matches.Match;
  return {
    matches: matches.map((match) => ({
      matchId: match.MatchId,
      homeTeamId: match.HomeTeamId,
      homeTeamName: match.HomeTeamName,
      awayTeamId: match.AwayTeamId,
      awayTeamName: match.AwayTeamName,
      matchDate: match.MatchDate,
      matchType: match.MatchType,
      round: match.MatchRound,
      group: match.Group,
      status: match.Status,
      homeGoals: match.HomeGoals,
      awayGoals: match.AwayGoals,
    })),
  };
}

// --- nationalteamdetails (1.3) ---------------------------------------------
// The retained capture filename predates discovery that the response advertises Version 1.3;
// the schema follows the response body and the endpoint wrapper pins 1.3.

const NationalTeamDetailsSchema = z.object({
  HattrickData: z
    .object({
      FileName: z.literal('nationalTeamDetails.xml'),
      Version: z.literal('1.3'),
      Team: z
        .object({
          TeamID: num,
          TeamName: z.string(),
          NationalCoach: z
            .object({
              NationalCoachUserID: num,
              NationalCoachLoginname: z.string(),
            })
            .passthrough(),
          League: z
            .object({
              LeagueID: num,
              LeagueName: z.string(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough(),
});

export interface NationalTeamDetailsSummary {
  teamId: number;
  teamName: string;
  leagueId: number;
  leagueName: string;
  coachUserId: number;
  coachLoginName: string;
}

export function parseNationalTeamDetails(raw: unknown): NationalTeamDetailsSummary {
  const team = NationalTeamDetailsSchema.parse(raw).HattrickData.Team;
  return {
    teamId: team.TeamID,
    teamName: team.TeamName,
    leagueId: team.League.LeagueID,
    leagueName: team.League.LeagueName,
    coachUserId: team.NationalCoach.NationalCoachUserID,
    coachLoginName: team.NationalCoach.NationalCoachLoginname,
  };
}
