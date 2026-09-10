import { z } from 'zod';
import nationalTeamIds from '../data/national-team-ids.json' with { type: 'json' };
import { nationalDateISO } from './nationalDates.js';
export { nationalDateISO } from './nationalDates.js';

/** Saved, complete NTFormerCoaches evidence, including the current tenure and unlinked users. */
export interface NationalCoachHistory {
  teamId: number;
  isYouth: boolean;
  complete: boolean;
  capturedAt: string;
  sourceURL: string;
  entries: Array<{ teamId: number; date: string; userId: number; name: string; sourceURL?: string; text?: string; links: Array<{ text: string; href: string }> }>;
}
export interface VerifiedNationalTrophyWinner {
  table: 'worldCupChampion' | 'nationalCupChampion';
  isYouth: boolean;
  edition?: number;
  cupId?: number;
  season?: number;
  slot: 'champion' | 'runnerUp' | 'thirdFourth';
  podiumIndex?: number;
  country: string;
  finalDate: string;
  teamId?: number;
  userId: number;
  name: string;
  sources: string[];
  evidence: string;
}
export interface NationalCoachRecoveryInput {
  histories?: readonly NationalCoachHistory[];
  verifiedWinners?: readonly VerifiedNationalTrophyWinner[];
}
export interface NationalPodiumRow {
  isYouth: boolean;
  edition?: number;
  cupId?: number;
  season?: number;
  finishedDate?: string | null;
  finalDate?: string | null;
  status?: string | null;
  champion: string | null;
  runnerUp: string | null;
  thirdFourth: string;
  championTeamId?: number | null;
  runnerUpTeamId?: number | null;
  thirdFourthTeamIds?: string;
  championUserId: number | null;
  championUserName: string | null;
  runnerUpUserId: number | null;
  thirdFourthUserIds: string;
}
export interface NationalCoachSnapshot {
  teams: Array<{ countryName: string; nationalTeamId: number | null; u20TeamId: number | null }>;
  registeredCups: Array<{ cupId: number; isYouth: boolean }>;
  worldCups: NationalPodiumRow[];
  nationalCups: NationalPodiumRow[];
}
export interface NationalCoachEvidence {
  basis: 'complete-coach-history' | 'verified-trophy';
  userId: number;
  name: string;
  teamId?: number;
  sources: string[];
  evidence: VerifiedNationalTrophyWinner | { history: NationalCoachHistory; entry: NationalCoachHistory['entries'][number]; nextEntry?: NationalCoachHistory['entries'][number] };
}
export interface NationalCoachPlan {
  key: string;
  table: VerifiedNationalTrophyWinner['table'];
  stored: NationalPodiumRow;
  slot: VerifiedNationalTrophyWinner['slot'];
  podiumIndex?: number;
  country: string;
  teamId?: number;
  status: 'ready' | 'already-attributed' | 'conflict' | 'unresolved' | 'applied' | 'stale';
  reason?: string;
  evidence: NationalCoachEvidence[];
  selected?: NationalCoachEvidence;
}
const positive = z.number().int().positive();
const HistorySchema = z.object({
  teamId: positive, isYouth: z.boolean(), complete: z.boolean(), capturedAt: z.string().datetime(), sourceURL: z.string().url(),
  entries: z.array(z.object({ teamId: positive, date: z.string(), userId: z.number().int().nonnegative(), name: z.string(), sourceURL: z.string().url().optional(), text: z.string().optional(), links: z.array(z.object({ text: z.string(), href: z.string() })) })),
});
const WinnerSchema = z.object({
  table: z.enum(['worldCupChampion', 'nationalCupChampion']), isYouth: z.boolean(), edition: positive.optional(), cupId: positive.optional(), season: positive.optional(),
  slot: z.enum(['champion', 'runnerUp', 'thirdFourth']), podiumIndex: z.number().int().min(0).max(1).optional(),
  country: z.string().min(1), finalDate: z.string(), teamId: positive.optional(), userId: positive, name: z.string().trim().min(1),
  sources: z.array(z.string().url()).min(1), evidence: z.string().trim().min(1),
}).superRefine((r, ctx) => {
  if (r.table === 'worldCupChampion' ? !r.edition || r.cupId !== undefined || r.season !== undefined : !r.cupId || !r.season || r.edition !== undefined) ctx.addIssue({ code: 'custom', message: 'Wrong competition key fields' });
  if ((r.slot === 'thirdFourth') !== (r.podiumIndex !== undefined)) ctx.addIssue({ code: 'custom', message: 'Only bronze requires podiumIndex' });
});
const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const validId = (n: number | null | undefined): n is number => Number.isSafeInteger(n) && n! > 0;

function historyURL(source: string, teamId: number): boolean {
  try {
    const u = new URL(source);
    const ids = [...u.searchParams].filter(([k]) => k.toLowerCase() === 'teamid').map(([, v]) => Number(v));
    return u.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(u.hostname) && /\/NTFormerCoaches\.aspx$/i.test(u.pathname) && ids.length === 1 && ids[0] === teamId;
  } catch { return false; }
}
function entryLinkMatches(entry: NationalCoachHistory['entries'][number]): boolean {
  const linked = entry.links.flatMap((link) => {
    try {
      const u = new URL(link.href.replace(/&amp;/gi, '&'), 'https://www.hattrick.org');
      if (u.protocol !== 'https:' || !/(^|\.)hattrick\.org$/i.test(u.hostname) || !/\/Club\/Manager\/?$/i.test(u.pathname)) return [];
      return [...u.searchParams].filter(([key, value]) => key.toLowerCase() === 'userid' && /^\d+$/.test(value)).map(([, value]) => ({ userId: Number(value), name: clean(link.text) }));
    } catch { return []; }
  });
  return entry.userId === 0 ? linked.length === 0 : linked.length > 0 && linked.every((link) => link.userId === entry.userId && link.name === clean(entry.name));
}
function countryOf(name: string, isYouth: boolean): string | null {
  if (/^U(?:20|21)\s/i.test(name)) return isYouth ? clean(name.replace(/^U(?:20|21)\s+/i, '')) : null;
  return clean(name);
}
function podiumNames(value: string, teams: NationalCoachSnapshot['teams'], isYouth: boolean): string[] | null {
  if (!value) return [];
  // A country can contain the separator itself ("Hong Kong, China"). Find the unique 1/2-name
  // decomposition against the national registry, rather than shifting medal indices by splitting.
  const known = (s: string) => teams.some((t) => clean(t.countryName) === countryOf(s, isYouth));
  const candidates: string[][] = known(value) ? [[value]] : [];
  for (let pos = value.indexOf(', '); pos !== -1; pos = value.indexOf(', ', pos + 2)) {
    const a = value.slice(0, pos), b = value.slice(pos + 2);
    if (known(a) && known(b)) candidates.push([a, b]);
  }
  return candidates.length === 1 ? candidates[0]! : null;
}
type CompetitionKey = Pick<NationalPodiumRow, 'isYouth' | 'edition' | 'cupId' | 'season'>;
const rowKey = (table: NationalCoachPlan['table'], r: CompetitionKey) => table === 'worldCupChampion' ? `${table}:${r.isYouth}:${r.edition}` : `${table}:${r.cupId}:${r.season}`;
const slotKey = (table: NationalCoachPlan['table'], r: CompetitionKey, slot: NationalCoachPlan['slot'], index?: number) => `${rowKey(table, r)}:${slot}${index === undefined ? '' : `:${index}`}`;
function storedId(r: NationalPodiumRow, slot: NationalCoachPlan['slot'], index?: number): number | null {
  if (slot === 'champion') return r.championUserId;
  if (slot === 'runnerUp') return r.runnerUpUserId;
  const value = r.thirdFourthUserIds.split(',')[index!] ?? '';
  return value.trim() === '' ? null : /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
}

/** Native and English nation labels share a league identity, not a fuzzy name match. Any
 * populated DB disagreement invalidates that league's seed AND alias mappings for this plan. */
export function nationalCoachTeamRegistry(dbTeams: ReadonlyArray<{ leagueId?: number; countryName: string; nationalTeamId: number | null; u20TeamId: number | null }>): NationalCoachSnapshot['teams'] {
  const seeds = Object.entries(nationalTeamIds).map(([countryName, ids]) => ({ countryName, ...ids }));
  const byLeague = new Map(seeds.map((s) => [s.leagueId, s]));
  const conflicts = new Set<number>();
  for (const row of dbTeams) {
    const seed = row.leagueId === undefined ? undefined : byLeague.get(row.leagueId);
    if (seed && ((validId(row.nationalTeamId) && row.nationalTeamId !== seed.nationalTeamId) || (validId(row.u20TeamId) && row.u20TeamId !== seed.u20TeamId))) conflicts.add(seed.leagueId);
  }
  const identities: NationalCoachSnapshot['teams'] = seeds.map((s) => ({ countryName: s.countryName, nationalTeamId: conflicts.has(s.leagueId) ? null : s.nationalTeamId, u20TeamId: conflicts.has(s.leagueId) ? null : s.u20TeamId }));
  for (const row of dbTeams) {
    const seed = row.leagueId === undefined ? undefined : byLeague.get(row.leagueId);
    if (seed) identities.push({ countryName: row.countryName, nationalTeamId: conflicts.has(seed.leagueId) ? null : seed.nationalTeamId, u20TeamId: conflicts.has(seed.leagueId) ? null : seed.u20TeamId });
    else if (validId(row.nationalTeamId) || validId(row.u20TeamId)) identities.push({ countryName: row.countryName, nationalTeamId: row.nationalTeamId, u20TeamId: row.u20TeamId });
  }
  return [...new Map(identities.map((t) => [JSON.stringify(t), t])).values()];
}

/** Pure plan. Raw legacy tenure lists are intentionally insufficient: completeness and capture
 * coverage must be demonstrated, and a retired/unlinked coach remains a real tenure boundary. */
export function planNationalCoachRecovery(input: NationalCoachRecoveryInput, snapshot: NationalCoachSnapshot, opts: { now?: string } = {}) {
  const histories = (input.histories ?? []).map((h) => HistorySchema.parse(h));
  const winners = (input.verifiedWinners ?? []).map((w) => WinnerSchema.parse(w));
  const today = nationalDateISO((opts.now ?? new Date().toISOString()).slice(0, 10));
  if (!today) throw new Error('Invalid current date');
  const plans: NationalCoachPlan[] = [];
  const rejected: Array<{ reason: string; evidence: NationalCoachHistory | VerifiedNationalTrophyWinner }> = [];
  const acceptable = histories.filter((h) => {
    const captured = nationalDateISO(h.capturedAt.slice(0, 10));
    const reason = !h.complete ? 'Partial coaching history cannot establish tenure coverage' :
      !captured || captured > today ? 'Invalid or future history capture date' :
      !historyURL(h.sourceURL, h.teamId) ? 'History source does not identify this national team' :
      !h.entries.length || h.entries.some((e) => e.teamId !== h.teamId || !nationalDateISO(e.date) || nationalDateISO(e.date)! > captured || !entryLinkMatches(e) || (e.userId > 0 && !clean(e.name)) || (e.sourceURL && !historyURL(e.sourceURL, h.teamId))) ? 'Invalid, mixed-team, undated, unverified-link or future tenure boundary' : undefined;
    if (reason) rejected.push({ reason, evidence: h });
    return !reason;
  });
  const usedDirect = new Set<VerifiedNationalTrophyWinner>();
  for (const [table, rows] of [['worldCupChampion', snapshot.worldCups], ['nationalCupChampion', snapshot.nationalCups]] as const) for (const row of rows) {
    const date = nationalDateISO(table === 'worldCupChampion' ? row.finishedDate : row.finalDate);
    const finished = !!row.champion && !!date && date <= today && (table === 'worldCupChampion' || (row.status?.trim().toLowerCase() === 'finished' && snapshot.registeredCups.some((c) => c.cupId === row.cupId && c.isYouth === row.isYouth)));
    const names = podiumNames(row.thirdFourth, snapshot.teams, row.isYouth);
    const bronzeIds = (row.thirdFourthTeamIds ?? '').split(',');
    const bronzeUsers = row.thirdFourthUserIds.split(',');
    const bronzeAligned = names !== null && (bronzeIds.length <= names.length || !bronzeIds.some((v) => v.trim())) && (bronzeUsers.length <= names.length || !bronzeUsers.some((v) => v.trim()));
    const slots: Array<{ slot: NationalCoachPlan['slot']; country: string; index?: number; teamId?: number | null }> = [
      ...(row.champion ? [{ slot: 'champion' as const, country: row.champion, teamId: row.championTeamId }] : []),
      ...(row.runnerUp ? [{ slot: 'runnerUp' as const, country: row.runnerUp, teamId: row.runnerUpTeamId }] : []),
      ...(names ?? (row.thirdFourth ? [row.thirdFourth] : [])).map((country, index) => ({ slot: 'thirdFourth' as const, country, index, teamId: bronzeIds[index]?.trim() ? Number(bronzeIds[index]) : undefined })),
    ];
    for (const slot of slots) {
      const plan: NationalCoachPlan = { key: slotKey(table, row, slot.slot, slot.index), table, stored: row, slot: slot.slot, ...(slot.index === undefined ? {} : { podiumIndex: slot.index }), country: slot.country, status: 'unresolved', evidence: [] };
      plans.push(plan);
      if (!finished) { plan.reason = 'Competition is not verified finished, has an invalid/future date, or has an unregistered bracket'; continue; }
      if (slot.slot === 'thirdFourth' && !bronzeAligned) { plan.reason = 'Bronze nation/team/user arrays are ambiguous or misaligned'; continue; }
      const nation = countryOf(slot.country, row.isYouth);
      const candidates = snapshot.teams.filter((t) => clean(t.countryName) === nation);
      const expected = candidates.length === 1 ? (row.isYouth ? candidates[0]!.u20TeamId : candidates[0]!.nationalTeamId) : undefined;
      const teamId = slot.teamId ?? expected;
      const knownBracket = snapshot.teams.some((t) => (row.isYouth ? t.u20TeamId : t.nationalTeamId) === teamId);
      const oppositeBracket = snapshot.teams.some((t) => (row.isYouth ? t.nationalTeamId : t.u20TeamId) === teamId);
      if (!nation || !validId(expected) || !validId(teamId) || !knownBracket || oppositeBracket || expected !== teamId) { plan.reason = 'National team identity cannot be verified in this senior/youth bracket'; continue; }
      plan.teamId = teamId;
      for (const w of winners) {
        if (slotKey(w.table, w, w.slot, w.podiumIndex) !== plan.key) continue;
        usedDirect.add(w);
        if (w.isYouth !== row.isYouth || clean(w.country) !== clean(slot.country) || nationalDateISO(w.finalDate) !== date || !/^\d{4}-\d{2}-\d{2}$/.test(w.finalDate) || (w.teamId !== undefined && w.teamId !== teamId) || w.sources.some((s) => new URL(s).protocol !== 'https:')) {
          rejected.push({ reason: 'Direct trophy evidence disagrees with stored bracket, podium nation, final date or national team', evidence: w });
          continue;
        }
        plan.evidence.push({ basis: 'verified-trophy', userId: w.userId, name: w.name, teamId, sources: w.sources, evidence: w });
      }
      let historyBlocked = false;
      // Bronze belongs to the semifinal, not necessarily the final date. Without a stored,
      // observed semifinal date we cannot infer that coach from the final; require direct proof.
      if (slot.slot === 'thirdFourth' && !plan.evidence.length) plan.reason = 'Bronze requires direct trophy evidence; the final date does not establish the semifinal coach';
      for (const h of acceptable.filter((h) => slot.slot !== 'thirdFourth' && h.teamId === teamId && h.isYouth === row.isYouth && h.capturedAt.slice(0, 10) >= date!)) {
        const entries = [...h.entries].sort((a, b) => nationalDateISO(a.date)!.localeCompare(nationalDateISO(b.date)!));
        if (entries.some((e) => nationalDateISO(e.date) === date)) { historyBlocked = true; plan.reason = 'Coach transition shares the final date; within-day ordering is unknown'; continue; }
        const prior = entries.filter((e) => nationalDateISO(e.date)! < date!);
        const entry = prior.at(-1);
        if (!entry) { historyBlocked = true; plan.reason = 'No recorded coach predates this final'; continue; }
        const contemporaries = prior.filter((e) => nationalDateISO(e.date) === nationalDateISO(entry.date));
        if (!entry.userId || new Set(contemporaries.map((e) => e.userId)).size !== 1) { historyBlocked = true; plan.reason = 'Latest coach boundary is retired/unlinked or same-day ambiguous'; continue; }
        const nextEntry = entries.find((e) => nationalDateISO(e.date)! > date!);
        plan.evidence.push({ basis: 'complete-coach-history', userId: entry.userId, name: entry.name, teamId, sources: [h.sourceURL], evidence: { history: h, entry, ...(nextEntry ? { nextEntry } : {}) } });
      }
      const existing = storedId(row, slot.slot, slot.index);
      if (!plan.evidence.length) { plan.reason ??= 'No complete historical coaching coverage or verified trophy evidence'; continue; }
      if (historyBlocked && !plan.evidence.some((e) => e.basis === 'verified-trophy')) { plan.status = 'conflict'; plan.reason = 'Complete histories disagree about whether the coaching interval is attributable'; continue; }
      if (new Set(plan.evidence.map((e) => e.userId)).size !== 1) { plan.status = 'conflict'; plan.reason = 'Verified sources disagree about the coach'; continue; }
      plan.selected = plan.evidence.find((e) => e.basis === 'verified-trophy') ?? plan.evidence[0];
      if (validId(existing)) { plan.status = existing === plan.selected!.userId ? 'already-attributed' : 'conflict'; plan.reason = existing === plan.selected!.userId ? 'Positive attribution already matches' : 'Established positive attribution differs and is preserved'; }
      else if (existing !== null && existing !== 0) { plan.status = 'conflict'; plan.reason = 'Unsupported stored coach sentinel or malformed bronze slot'; }
      else { plan.status = 'ready'; delete plan.reason; }
    }
  }
  for (const w of winners) if (!usedDirect.has(w)) rejected.push({ reason: 'No matching finished and identity-verified podium slot', evidence: w });
  for (const plan of plans) if (plan.status === 'unresolved' && validId(storedId(plan.stored, plan.slot, plan.podiumIndex))) {
    plan.status = 'already-attributed';
    plan.reason = `Existing positive attribution preserved; not reverified: ${plan.reason ?? 'no new evidence'}`;
  }
  return { plans, rejected };
}

/** Read-only unless apply:true; atomic per podium row, with every original identity/owner guarded. */
export async function applyNationalCoachRecovery(input: NationalCoachRecoveryInput, opts: { apply?: boolean } = {}) {
  const { prisma } = await import('../db/client.js');
  const { NT_CUPS } = await import('./ntCups.js');
  const [dbTeams, worldCups, nationalCups] = await Promise.all([
    prisma.nationalLeague.findMany({ select: { leagueId: true, countryName: true, nationalTeamId: true, u20TeamId: true } }),
    prisma.worldCupChampion.findMany(), prisma.nationalCupChampion.findMany(),
  ]);
  // A baked-cache reconstruction can leave DB IDs null and use English display names. The
  // committed CHPP-derived registry supplies native names used by the historical podiums.
  // Check populated IDs by leagueId, so an English DB label cannot hide a conflict with its
  // native seed label. Contradictory identities are disabled, never silently selected.
  const teams = nationalCoachTeamRegistry(dbTeams);
  const report = planNationalCoachRecovery(input, { teams, worldCups, nationalCups, registeredCups: NT_CUPS });
  if (opts.apply) {
    const groups = new Map<string, NationalCoachPlan[]>();
    for (const plan of report.plans.filter((p) => p.status === 'ready')) {
      const key = rowKey(plan.table, plan.stored);
      groups.set(key, [...(groups.get(key) ?? []), plan]);
    }
    for (const plans of groups.values()) {
      const first = plans[0]!, r = first.stored;
      const data: { championUserId?: number; championUserName?: string; runnerUpUserId?: number; thirdFourthUserIds?: string } = {};
      const bronze = r.thirdFourthUserIds.split(',');
      for (const p of plans) {
        if (p.slot === 'champion') { data.championUserId = p.selected!.userId; data.championUserName = p.selected!.name; }
        else if (p.slot === 'runnerUp') data.runnerUpUserId = p.selected!.userId;
        else { while (bronze.length <= p.podiumIndex!) bronze.push(''); bronze[p.podiumIndex!] = String(p.selected!.userId); data.thirdFourthUserIds = bronze.join(','); }
      }
      const changed = await prisma.$transaction(async (tx) => {
        const where = { isYouth: r.isYouth, champion: r.champion, runnerUp: r.runnerUp, thirdFourth: r.thirdFourth, championUserId: r.championUserId, championUserName: r.championUserName, runnerUpUserId: r.runnerUpUserId, thirdFourthUserIds: r.thirdFourthUserIds };
        const result = first.table === 'worldCupChampion'
          ? await tx.worldCupChampion.updateMany({ where: { ...where, edition: r.edition!, finishedDate: r.finishedDate }, data })
          : await tx.nationalCupChampion.updateMany({ where: { ...where, cupId: r.cupId!, season: r.season!, finalDate: r.finalDate, status: r.status, championTeamId: r.championTeamId, runnerUpTeamId: r.runnerUpTeamId, thirdFourthTeamIds: r.thirdFourthTeamIds }, data });
        if (result.count !== 1) return false;
        for (const p of plans) await tx.hattrickUser.upsert({ where: { userId: p.selected!.userId }, update: {}, create: { userId: p.selected!.userId, loginName: p.selected!.name, isBot: false } });
        return true;
      });
      for (const p of plans) { p.status = changed ? 'applied' : 'stale'; if (!changed) p.reason = 'Podium changed after planning; no write'; }
    }
  }
  const counts = { ready: 0, applied: 0, conflicts: 0, unresolved: 0, alreadyAttributed: 0, stale: 0, rejected: report.rejected.length };
  for (const p of report.plans) { if (p.status === 'conflict') counts.conflicts++; else if (p.status === 'already-attributed') counts.alreadyAttributed++; else counts[p.status]++; }
  return { apply: opts.apply === true, counts, ...report };
}
