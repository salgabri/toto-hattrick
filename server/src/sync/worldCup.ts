import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { mergeNationalPodiumFacts } from './nationalPodiumIngest.js';
import { validSuppliedNationalDates } from './nationalDates.js';

/**
 * World Cup (senior + youth) — a champion NATION per edition, not a manager/club, so it lives
 * outside the CupChampion model entirely. `cupmatches` does not index national-team competitions,
 * so the original history came from the retained World Cup roll-of-honour seed. New-format senior
 * and U21 editions are now monitored through the official `tournamentdetails` and
 * `tournamentfixtures` XML files by officialTournaments.ts. The youth bracket was "U20" through
 * edition 31 and "U21" from edition 32 on.
 */
export interface WorldCupEdition {
  edition: number;
  ageGroup?: string;
  host: string;
  finished: string | null;
  champion: string | null;
  runnerUp: string | null;
  thirdFourth: string[];
}

export interface WorldCupIngestResult { senior: number; youth: number; conflicts: number }

export async function ingestWorldCupHistory(data: { senior: WorldCupEdition[]; youth: WorldCupEdition[] }): Promise<WorldCupIngestResult> {
  const result = { senior: 0, youth: 0, conflicts: 0 };
  for (const [bracket, editions] of [['senior', data.senior], ['youth', data.youth]] as const) for (const e of editions) {
    if (!Number.isSafeInteger(e.edition) || e.edition <= 0 || e.thirdFourth.length > 2 || e.thirdFourth.some((n) => !n.trim()) || !validSuppliedNationalDates(e.finished)) { result.conflicts++; continue; }
    const isYouth = bracket === 'youth';
    const facts = { ...(isYouth ? { ageGroup: e.ageGroup } : {}), host: e.host, finishedDate: e.finished, champion: e.champion, runnerUp: e.runnerUp, thirdFourth: e.thirdFourth.join(', ') };
    const accepted = await prisma.$transaction(async (tx) => {
      const where = { isYouth_edition: { isYouth, edition: e.edition } };
      const stored = await tx.worldCupChampion.findUnique({ where });
      if (!stored) await tx.worldCupChampion.create({ data: { isYouth, edition: e.edition, ...facts } });
      else {
        const merged = mergeNationalPodiumFacts(stored, facts);
        if (merged.conflicts.length) return false;
        if (Object.keys(merged.data).length) await tx.worldCupChampion.update({ where, data: merged.data });
      }
      return true;
    });
    if (accepted) result[bracket]++; else result.conflicts++;
  }
  return result;
}

export interface CoachTenure {
  teamId: number;
  date: string; // "DD.MM.YYYY", the date this coach TOOK OVER
  userId: number; // 0 = "Retired user" (UNKNOWN sentinel, same convention as everywhere else)
  name: string;
}

export interface CoachAttributionResult { attributed: number; eligible: number; medals: number; medalSlots: number }

/** Flat legacy tenure rows do not prove complete historical coverage. Use the audited recovery
 * planner with saved full histories instead; never recompute/clear established coach medals. */
export async function attributeWorldCupCoaches(_token: TokenPair, _tenures: CoachTenure[]): Promise<CoachAttributionResult> {
  throw new Error('Unverified flat coach-tenure attribution is disabled. Use recover:national-coaches with complete captured histories or verified trophy evidence; existing World Cup attributions are preserved.');
}
