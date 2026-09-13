import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { Match } from '@prisma/client';
import { prisma } from '../db/client.js';
import { fetchCupMatches, fetchMatchDetails } from '../chpp/endpoints.js';
import { parseCupMatches } from '../schemas/index.js';
import type { TokenPair } from '../chpp/auth.js';
import { parseCupFinalMatch, type CupFinalMatch } from '../schemas/cupFinal.js';
import { captureEvidence, evidenceConfiguration, InvalidEvidenceError, matchEvidenceKey, observationEvidenceKey, readEvidence, roundEvidenceKey } from '../update/evidence.js';
import { StorageConflictError, StorageUnavailableError } from '../update/storage.js';

export interface CupFinalSummary {
  cupId: number; season: number; matchId: number; round?: number;
  homeTeamName: string; awayTeamName: string; homeGoals: number; awayGoals: number;
}
export interface VerifiedCupFinalWinner {
  cupId: number; season: number; matchId: number; teamId: number; teamName: string;
  sources: string[]; evidence: string;
}
export interface ResolvedCupFinal {
  teamId: number; teamName: string; runnerUpTeamName: string;
  homeGoals: number; awayGoals: number;
  penalties: boolean;
  basis: 'score' | 'aggregate' | 'extra-time-event' | 'verified-historical-winner';
}
export type CupFinalResolution = { winner: ResolvedCupFinal; reason?: never; noWinner?: never } | { winner?: never; reason: string; noWinner?: boolean };
const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
// Actual matchdetails 3.0 samples: domestic finals use 3; Masters 771464494 uses 7/context183.
const expectedMatchType = (cupId: number) => cupId === 183 ? 7 : 3;
export type StoredCupFinalMatch = Pick<Match, 'matchId' | 'matchType' | 'homeTeamId' | 'awayTeamId' | 'homeTeamName' | 'awayTeamName' | 'homeGoals' | 'awayGoals'>;
export interface CupFinalRound {
  cupId: number; season: number; round: number;
  matches: Array<{ matchId: number; homeTeamName: string; awayTeamName: string; homeGoals: number | null; awayGoals: number | null }>;
}
export type CupFinalScore = { homeWon: boolean; basis: 'score' | 'aggregate'; format: 'single' | 'two-leg' } | { reason: string; format: 'single' | 'two-leg' | 'unknown' };

/** The last cup round used to be the SECOND leg. Inspect the preceding round before deciding. */
export function cupFinalScore(summary: CupFinalSummary, previous?: CupFinalRound): CupFinalScore {
  const unknown = (reason: string): CupFinalScore => ({ reason, format: 'unknown' });
  if (!summary.round || summary.round < 1) return unknown('Final round number is missing');
  if (summary.round > 1 && (!previous || previous.cupId !== summary.cupId || previous.season !== summary.season || previous.round !== summary.round - 1))
    return unknown('Preceding round identity is unavailable or inconsistent');
  const first = previous?.matches.length === 1 ? previous.matches[0] : undefined;
  const pair = [clean(summary.homeTeamName), clean(summary.awayTeamName)];
  if (pair[0] === pair[1]) return unknown('Finalists do not have distinct identities');
  const samePair = first && [clean(first.homeTeamName), clean(first.awayTeamName)].every(name => pair.includes(name)) && clean(first.homeTeamName) !== clean(first.awayTeamName);
  if (samePair) {
    if (first.matchId === summary.matchId || first.homeGoals === null || first.awayGoals === null)
      return { reason: 'First leg has no distinct completed score', format: 'two-leg' };
    const firstHomeIsFinalHome = clean(first.homeTeamName) === pair[0];
    const homeTotal = summary.homeGoals + (firstHomeIsFinalHome ? first.homeGoals : first.awayGoals);
    const awayTotal = summary.awayGoals + (firstHomeIsFinalHome ? first.awayGoals : first.homeGoals);
    if (homeTotal === awayTotal) return { reason: 'Two-leg aggregate remains level; explicit cup-winner evidence is required', format: 'two-leg' };
    return { homeWon: homeTotal > awayTotal, basis: 'aggregate', format: 'two-leg' };
  }
  if (summary.round > 1) {
    const semis = previous!.matches;
    if (semis.length !== 2) return unknown('Preceding round is neither a matching first leg nor two semifinals; final format is unresolved');
    if (semis[0]!.matchId === semis[1]!.matchId || semis.some(semi => semi.matchId === summary.matchId || semi.homeGoals === null || semi.awayGoals === null))
      return unknown('Semifinals do not have distinct completed match identities');
    const names = semis.map(semi => [clean(semi.homeTeamName), clean(semi.awayTeamName)]);
    if (names.some(teams => teams[0] === teams[1] || teams.filter(team => pair.includes(team)).length !== 1) || pair.some(finalist => names.filter(teams => teams.includes(finalist)).length !== 1))
      return unknown('Preceding semifinals do not contain the two finalists separately');
  }
  if (summary.homeGoals === summary.awayGoals) return { reason: 'Single-match final remains level', format: 'single' };
  return { homeWon: summary.homeGoals > summary.awayGoals, basis: 'score', format: 'single' };
}

const VerifiedSchema = z.object({
  cupId: z.number().int().positive(), season: z.number().int().positive(), matchId: z.number().int().positive(),
  teamId: z.number().int().positive(), teamName: z.string().min(1),
  sources: z.array(z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname);
  })).min(1), evidence: z.string().trim().min(20),
});

/** Exact, reviewable facts only. No current owner, scored-penalty count, or home/away guess. */
export function resolveCupFinal(
  summary: CupFinalSummary,
  match: CupFinalMatch,
  verified: readonly VerifiedCupFinalWinner[] = [],
  previous?: CupFinalRound,
): CupFinalResolution {
  if (summary.matchId !== match.matchId || summary.cupId !== match.cupId || match.matchType !== expectedMatchType(summary.cupId))
    return { reason: 'Match identity or cup context differs from the requested final' };
  if (summary.homeGoals !== match.homeGoals || summary.awayGoals !== match.awayGoals ||
      clean(summary.homeTeamName) !== clean(match.homeTeamName) || clean(summary.awayTeamName) !== clean(match.awayTeamName))
    return { reason: 'Stored cup final and match details disagree on participants or score' };
  if (match.homeTeamId === match.awayTeamId || !match.finishedDate)
    return { reason: 'Final has no valid pair of teams or finished date' };
  // Real sample 541334258: event 500 says neither club fielded nine players; no side won.
  if (match.events.some(e => e.type === 500 && e.part === 0 && e.minute === 0 && e.teamId === 0))
    return { reason: 'Mutual walkover: the final has no playable winner', noWinner: true };
  const direct = verified.filter(v => v.cupId === summary.cupId && v.season === summary.season && v.matchId === summary.matchId);
  if (direct.some(v => !VerifiedSchema.safeParse(v).success)) return { reason: 'Historical winner evidence is malformed or has no primary source' };
  if (direct.some(v => v.teamId !== match.homeTeamId && v.teamId !== match.awayTeamId)) return { reason: 'Historical winner does not belong to this final' };
  if (direct.some(v => clean(v.teamName) !== clean(v.teamId === match.homeTeamId ? match.homeTeamName : match.awayTeamName)))
    return { reason: 'Historical winner name disagrees with its numeric team identity' };
  const score = cupFinalScore(summary, previous);
  // Event 72 wins THIS MATCH. In a two-leg tie it does not establish the cup's aggregate winner.
  const events = score.format === 'single' ? match.events.filter(e => e.type === 72) : [];
  if (events.some(e => e.part !== 3 || e.minute <= 90 || ![match.homeTeamId, match.awayTeamId].includes(e.teamId)))
    return { reason: 'Extra-time winner event has an invalid phase or team' };
  const candidates = new Set([...direct.map(v => v.teamId), ...events.map(e => e.teamId)]);
  const scoreWinner = 'homeWon' in score ? score.homeWon ? match.homeTeamId : match.awayTeamId : undefined;
  if (scoreWinner) candidates.add(scoreWinner);
  if (candidates.size > 1) return { reason: 'Winner evidence conflicts; no result has been changed' };
  if (candidates.size !== 1) return { reason: 'reason' in score ? score.reason : 'Final has no explicit, attributable winner evidence' };
  const teamId = [...candidates][0]!;
  const homeWon = teamId === match.homeTeamId;
  return { winner: {
    teamId, teamName: homeWon ? match.homeTeamName : match.awayTeamName,
    runnerUpTeamName: homeWon ? match.awayTeamName : match.homeTeamName,
    homeGoals: summary.homeGoals, awayGoals: summary.awayGoals,
    penalties: score.format === 'single' && match.events.some(e => e.type === 71 && e.part === 4),
    basis: scoreWinner && 'basis' in score ? score.basis : events.length ? 'extra-time-event' : 'verified-historical-winner',
  } };
}

/** Archived summaries have no FinishedDate/context/events. Join their exact ID/participants/
 * score to the validated cupmatches response; only a decisive score/aggregate can resolve them. */
export function resolveStoredCupFinal(summary: CupFinalSummary, match: StoredCupFinalMatch, previous?: CupFinalRound): CupFinalResolution {
  if (summary.matchId !== match.matchId || (match.matchType !== null && match.matchType !== expectedMatchType(summary.cupId)))
    return { reason: 'Archived match identity or type differs from the requested cup final' };
  if (!Number.isSafeInteger(match.homeTeamId) || !Number.isSafeInteger(match.awayTeamId) || match.homeTeamId <= 0 || match.awayTeamId <= 0 || match.homeTeamId === match.awayTeamId)
    return { reason: 'Archived match has no valid distinct numeric finalist identities' };
  if (summary.homeGoals !== match.homeGoals || summary.awayGoals !== match.awayGoals || clean(summary.homeTeamName) !== clean(match.homeTeamName) || clean(summary.awayTeamName) !== clean(match.awayTeamName))
    return { reason: 'Archived match and cup final disagree on participants or completed score' };
  const score = cupFinalScore(summary, previous);
  if (!('homeWon' in score)) return { reason: `${score.reason}; archived match has no retained winner events` };
  return { winner: {
    teamId: score.homeWon ? match.homeTeamId : match.awayTeamId,
    teamName: score.homeWon ? match.homeTeamName : match.awayTeamName,
    runnerUpTeamName: score.homeWon ? match.awayTeamName : match.homeTeamName,
    homeGoals: summary.homeGoals, awayGoals: summary.awayGoals, penalties: false, basis: score.basis,
  } };
}

export const CupFinalRoundSchema = z.object({
  cupId: z.number().int().positive(), season: z.number().int().positive(), round: z.number().int().nonnegative(),
  matches: z.array(z.object({ matchId: z.number().int().positive(), homeTeamName: z.string().min(1), awayTeamName: z.string().min(1), homeGoals: z.number().int().nonnegative().nullable(), awayGoals: z.number().int().nonnegative().nullable() })),
});
export async function loadPreviousCupRound(token: TokenPair, summary: CupFinalSummary): Promise<{ previous?: CupFinalRound; reason?: string; fetched: boolean; pending?: boolean }> {
  if (!summary.round || summary.round <= 1) return { fetched: false };
  const configuration = evidenceConfiguration();
  const key = roundEvidenceKey(summary.cupId, summary.season, summary.round - 1);
  const identity = (previous: CupFinalRound) => previous.cupId === summary.cupId && previous.season === summary.season && previous.round === summary.round! - 1;
  if (configuration) {
    try {
      const retained = await readEvidence(configuration.store, key);
      if (retained) {
        const shaped = CupFinalRoundSchema.safeParse(retained.capture.payload);
        const previous = shaped.success ? shaped.data : parseCupMatches(retained.capture.payload);
        if (!identity(previous)) throw new InvalidEvidenceError();
        return { previous, fetched: false };
      }
    } catch (error) {
      if (error instanceof StorageUnavailableError || error instanceof StorageConflictError) throw error;
      return { reason: 'Retained preceding round cannot be validated; no re-fetch', fetched: false };
    }
  }
  const file = configuration ? join(configuration.workspacePath, 'cup-final-rounds', `${summary.cupId}-${summary.season}-${summary.round - 1}.json`)
    : fileURLToPath(new URL(`../../../.scrape/cup-final-rounds/${summary.cupId}-${summary.season}-${summary.round - 1}.json`, import.meta.url));
  if (existsSync(file)) {
    try {
      const text = readFileSync(file, 'utf8');
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { raw = text; }
      if (configuration) await captureEvidence({ store: configuration.store, key, source: 'cupmatches', apiVersion: '1.2', parserVersion: 'cup-final-round-v1', payload: raw });
      const previous = CupFinalRoundSchema.parse(raw);
      if (!identity(previous)) throw new InvalidEvidenceError();
      return { previous, fetched: false };
    } catch (error) {
      if (error instanceof StorageUnavailableError || error instanceof StorageConflictError) throw error;
      return { reason: 'Cached preceding round cannot be validated; no re-fetch', fetched: false };
    }
  }
  try {
    const raw = await fetchCupMatches(token, { cupId: summary.cupId, season: summary.season, cupRound: summary.round - 1 });
    let previous: CupFinalRound;
    try { previous = parseCupMatches(raw); }
    catch (error) {
      if (configuration) await captureEvidence({ store: configuration.store, key, source: 'cupmatches', apiVersion: '1.2', parserVersion: 'cup-final-round-v1', payload: raw });
      throw error;
    }
    const pending = previous.cupId === summary.cupId && previous.season === summary.season &&
      ((previous.round === 0 && !previous.matches.length) || (identity(previous) && (!previous.matches.length || previous.matches.some(match => match.homeGoals === null || match.awayGoals === null))));
    if (configuration) await captureEvidence({ store: configuration.store, key: pending ? observationEvidenceKey(key) : key, source: 'cupmatches', apiVersion: '1.2', parserVersion: 'cup-final-round-v1', payload: raw });
    if (pending) return { pending: true, fetched: true };
    if (!identity(previous))
      return { reason: 'Fetched preceding round does not match requested cup/season/round', fetched: true };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(previous));
    return { previous, fetched: true };
  } catch (error) {
    if (error instanceof StorageUnavailableError || error instanceof StorageConflictError || (configuration && error instanceof Error && error.name.startsWith('Chpp'))) throw error;
    return { reason: 'Preceding round could not be fetched or validated', fetched: true };
  }
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
function paths(matchId: number) {
  if (!Number.isSafeInteger(matchId) || matchId <= 0) throw new Error('Invalid match ID');
  const configuration = evidenceConfiguration();
  if (configuration) return { xml: join(configuration.workspacePath, 'samples', `matchdetails-3.0-${matchId}.local.xml`), json: join(configuration.workspacePath, 'cup-final-details', `${matchId}.json`) };
  return {
    xml: fileURLToPath(new URL(`../../samples/matchdetails-3.0-${matchId}.local.xml`, import.meta.url)),
    json: fileURLToPath(new URL(`../../../.scrape/cup-final-details/${matchId}.json`, import.meta.url)),
  };
}
export function readCachedCupFinalMatch(matchId: number): { match?: CupFinalMatch; cached: boolean; reason?: string } {
  const files = paths(matchId);
  const path = existsSync(files.json) ? files.json : existsSync(files.xml) ? files.xml : undefined;
  if (!path) return { cached: false };
  try {
    const text = readFileSync(path, 'utf8');
    const match = parseCupFinalMatch(path.endsWith('.xml') ? parser.parse(text) : JSON.parse(text));
    if (match.matchId !== matchId) return { cached: true, reason: 'Cached match identity differs; no re-fetch' };
    return { cached: true, match };
  } catch { return { cached: true, reason: 'Cached match cannot be validated; no re-fetch' }; }
}

/** Reuse captures and refuse to re-fetch any match already represented in the DB. */
export async function loadCupFinalMatch(token: TokenPair, matchId: number): Promise<{ match?: CupFinalMatch; storedMatch?: StoredCupFinalMatch; reason?: string; fetched: boolean; pending?: boolean }> {
  const configuration = evidenceConfiguration();
  const key = matchEvidenceKey(matchId);
  if (configuration) {
    try {
      const retained = await readEvidence(configuration.store, key);
      if (retained) {
        const match = parseCupFinalMatch(retained.capture.payload);
        if (match.matchId !== matchId) throw new InvalidEvidenceError();
        return { match, fetched: false };
      }
      const files = paths(matchId);
      const file = existsSync(files.json) ? files.json : existsSync(files.xml) ? files.xml : undefined;
      if (file) {
        const text = readFileSync(file, 'utf8');
        let raw: unknown;
        try { raw = file.endsWith('.xml') ? parser.parse(text) : JSON.parse(text); } catch { raw = text; }
        await captureEvidence({ store: configuration.store, key, source: 'matchdetails', apiVersion: '3.0', parserVersion: 'cup-final-match-v1', payload: raw });
      }
    } catch (error) {
      if (error instanceof StorageUnavailableError || error instanceof StorageConflictError) throw error;
      return { reason: 'Retained match cannot be validated; no re-fetch', fetched: false };
    }
  }
  const cached = readCachedCupFinalMatch(matchId);
  if (cached.cached) return { ...cached, fetched: false };
  const [storedMatch, storedDetail, storedCup] = await Promise.all([
    prisma.match.findUnique({ where: { matchId }, select: { matchId: true, matchType: true, homeTeamId: true, awayTeamId: true, homeTeamName: true, awayTeamName: true, homeGoals: true, awayGoals: true } }),
    prisma.matchDetail.findUnique({ where: { matchId }, select: { matchId: true } }),
    prisma.cupChampion.findFirst({ where: { finalMatchId: matchId }, select: { cupId: true } }),
  ]);
  if (storedMatch || storedDetail || storedCup) return { ...(storedMatch ? { storedMatch } : {}), fetched: false, reason: 'Match already stored; reuse archived summary if decisive, no re-fetch' };
  try {
    const raw = await fetchMatchDetails(token, matchId, { matchEvents: true });
    // Capture before the caller can store winner facts. A parser failure
    // remains discoverable on a fresh runner, and never silently fetches the same match again.
    let match: CupFinalMatch;
    try { match = parseCupFinalMatch(raw); }
    catch (error) {
      if (configuration) await captureEvidence({ store: configuration.store, key, source: 'matchdetails', apiVersion: '3.0', parserVersion: 'cup-final-match-v1', payload: raw });
      throw error;
    }
    const pending = match.matchId === matchId && !match.finishedDate;
    if (configuration) await captureEvidence({ store: configuration.store, key: pending ? observationEvidenceKey(key) : key, source: 'matchdetails', apiVersion: '3.0', parserVersion: 'cup-final-match-v1', payload: raw });
    if (pending) return { pending: true, fetched: true };
    if (match.matchId !== matchId) return { fetched: true, reason: 'Fetched match identity differs from the final' };
    const file = paths(matchId).json;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(raw));
    return { fetched: true, match };
  } catch (error) {
    if (error instanceof StorageUnavailableError || error instanceof StorageConflictError ||
        (error instanceof Error && error.name.startsWith('Chpp'))) throw error;
    return { fetched: true, reason: 'Final details could not be fetched or validated' };
  }
}
