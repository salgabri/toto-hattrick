import { z } from 'zod';

// Fields below are modelled from the real matchdetails 3.0 captures 18279050, 23654711 and
// 7095334 in server/samples. These historical finals retain a level score even though event 72
// explicitly names the extra-time MATCH winner. That is not necessarily the CUP winner in an
// older two-leg tie; cupFinals.ts establishes the format and computes the aggregate first.
// Unrecognised events never imply a winning team.
const integer = z.coerce.number().int().nonnegative();
const positive = integer.refine(n => n > 0);
const Event = z.object({
  EventTypeID: integer, SubjectTeamID: integer, Minute: integer, MatchPart: integer,
  EventText: z.string(),
});
const EventList = z.union([
  z.literal(''),
  z.object({ Event: z.union([Event, z.array(Event)]).transform(v => Array.isArray(v) ? v : [v]) }),
]).optional();
const Schema = z.object({ HattrickData: z.object({ Match: z.object({
  MatchID: positive, MatchType: integer, MatchContextId: positive,
  MatchDate: z.string().min(1), FinishedDate: z.string().nullish(),
  HomeTeam: z.object({ HomeTeamID: positive, HomeTeamName: z.string().min(1), HomeGoals: integer.nullish() }),
  AwayTeam: z.object({ AwayTeamID: positive, AwayTeamName: z.string().min(1), AwayGoals: integer.nullish() }),
  EventList,
}) }) });

export interface CupFinalMatch {
  matchId: number;
  matchType: number;
  cupId: number;
  matchDate: string;
  finishedDate: string | null;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  events: Array<{ type: number; teamId: number; minute: number; part: number; text: string }>;
}

export function parseCupFinalMatch(raw: unknown): CupFinalMatch {
  const m = Schema.parse(raw).HattrickData.Match;
  const events = !m.EventList ? [] : m.EventList.Event;
  return {
    matchId: m.MatchID, matchType: m.MatchType, cupId: m.MatchContextId,
    matchDate: m.MatchDate, finishedDate: m.FinishedDate || null,
    homeTeamId: m.HomeTeam.HomeTeamID, homeTeamName: m.HomeTeam.HomeTeamName,
    awayTeamId: m.AwayTeam.AwayTeamID, awayTeamName: m.AwayTeam.AwayTeamName,
    homeGoals: m.HomeTeam.HomeGoals ?? null, awayGoals: m.AwayTeam.AwayGoals ?? null,
    events: events.map(e => ({ type: e.EventTypeID, teamId: e.SubjectTeamID, minute: e.Minute, part: e.MatchPart, text: e.EventText })),
  };
}
