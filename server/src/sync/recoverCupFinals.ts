import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { parseCupFinalMatch } from '../schemas/cupFinal.js';
import { CupFinalRoundSchema, resolveCupFinal } from './cupFinals.js';

const Positive = z.number().int().positive();
const EvidenceSchema = z.object({
  entries: z.array(z.object({
    summary: z.object({ cupId: Positive, season: Positive, round: Positive, matchId: Positive,
      homeTeamName: z.string().min(1), awayTeamName: z.string().min(1), homeGoals: z.number().int().nonnegative(), awayGoals: z.number().int().nonnegative() }),
    previous: CupFinalRoundSchema, rawMatch: z.unknown(),
    sourceURLs: z.array(z.string().url()).min(3), captureSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});
type CupMetadata = { cupId: number; leagueId: number; countryName: string; cupName: string; isMain: boolean };
export interface CupFinalRecoveryPlan {
  cupId: number; season: number; matchId: number;
  status: 'ready' | 'already-stored' | 'no-winner' | 'unresolved' | 'conflict';
  reason?: string;
  basis?: string;
  expectedCup?: CupMetadata;
  create?: Prisma.CupChampionUncheckedCreateInput;
  sourceURLs: string[];
  captureSha256: string;
}
const metadata = (cup: CupMetadata): CupMetadata => ({ cupId: cup.cupId, leagueId: cup.leagueId, countryName: cup.countryName, cupName: cup.cupName, isMain: cup.isMain });

/** No network. All identities and scores must agree with the retained CHPP evidence. */
export async function planCupFinalRecovery(rawEvidence: unknown): Promise<CupFinalRecoveryPlan[]> {
  const evidence = EvidenceSchema.parse(rawEvidence);
  const plans: CupFinalRecoveryPlan[] = [];
  const seen = new Set<string>();
  for (const entry of evidence.entries) {
    const { summary } = entry;
    const key = `${summary.cupId}/${summary.season}`;
    if (seen.has(key)) throw new Error(`Duplicate final evidence ${key}`);
    seen.add(key);
    const base = { cupId: summary.cupId, season: summary.season, matchId: summary.matchId, sourceURLs: entry.sourceURLs, captureSha256: entry.captureSha256 };
    const cup = await prisma.cup.findUnique({ where: { cupId: summary.cupId } });
    if (!cup) { plans.push({ ...base, status: 'conflict', reason: 'Cup registry row is missing' }); continue; }
    const resolution = resolveCupFinal(summary, parseCupFinalMatch(entry.rawMatch), [], entry.previous);
    if (!resolution.winner) {
      plans.push({ ...base, status: resolution.noWinner ? 'no-winner' : 'unresolved', reason: resolution.reason });
      continue;
    }
    const winner = resolution.winner;
    const existing = await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId: summary.cupId, season: summary.season } } });
    if (existing) {
      const same = existing.finalMatchId === summary.matchId && existing.championTeamId === winner.teamId && existing.championTeamName === winner.teamName && existing.runnerUpTeamName === winner.runnerUpTeamName && existing.homeGoals === summary.homeGoals && existing.awayGoals === summary.awayGoals;
      plans.push({ ...base, status: same ? 'already-stored' : 'conflict', reason: same ? undefined : 'Existing winner differs; additions never overwrite archived results' });
      continue;
    }
    const duplicateMatch = await prisma.cupChampion.findFirst({ where: { finalMatchId: summary.matchId }, select: { cupId: true, season: true } });
    if (duplicateMatch) { plans.push({ ...base, status: 'conflict', reason: 'Final match is already assigned to another cup/season' }); continue; }
    plans.push({ ...base, status: 'ready', basis: winner.basis, expectedCup: metadata(cup), create: {
      ...metadata(cup), season: summary.season, finalMatchId: summary.matchId,
      championTeamId: winner.teamId, championTeamName: winner.teamName, runnerUpTeamName: winner.runnerUpTeamName,
      homeGoals: winner.homeGoals, awayGoals: winner.awayGoals, penalties: winner.penalties,
      // The winner's current owner is not historical ownership proof.
      championUserId: null, championUserName: null,
    } });
  }
  return plans;
}

/** Re-plan under a transaction: stale absence/metadata cannot overwrite or redirect an insert. */
export async function applyCupFinalRecovery(plans: readonly CupFinalRecoveryPlan[]): Promise<{ inserted: number; alreadyStored: number }> {
  const ready = plans.filter(p => p.status === 'ready');
  return prisma.$transaction(async tx => {
    let inserted = 0;
    let alreadyStored = 0;
    for (const p of ready) {
      if (!p.create || !p.expectedCup) throw new Error('Incomplete final recovery plan');
      const cup = await tx.cup.findUnique({ where: { cupId: p.cupId } });
      if (!cup || JSON.stringify(metadata(cup)) !== JSON.stringify(p.expectedCup)) throw new Error(`Cup ${p.cupId} metadata changed; transaction aborted`);
      const existing = await tx.cupChampion.findUnique({ where: { cupId_season: { cupId: p.cupId, season: p.season } } });
      if (existing) {
        if (existing.finalMatchId === p.matchId && existing.championTeamId === p.create.championTeamId && existing.championTeamName === p.create.championTeamName && existing.runnerUpTeamName === p.create.runnerUpTeamName && existing.homeGoals === p.create.homeGoals && existing.awayGoals === p.create.awayGoals) { alreadyStored++; continue; }
        throw new Error(`Final ${p.cupId}/${p.season} changed; transaction aborted`);
      }
      if (await tx.cupChampion.findFirst({ where: { finalMatchId: p.matchId }, select: { cupId: true } })) throw new Error(`Match ${p.matchId} was assigned elsewhere; transaction aborted`);
      await tx.cupChampion.create({ data: p.create });
      inserted++;
    }
    return { inserted, alreadyStored };
  });
}
