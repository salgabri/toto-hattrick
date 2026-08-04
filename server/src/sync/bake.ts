import { writeFileSync, mkdirSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { MASTERS_CUP_ID } from './masters.js';
import { isSeasonalCup } from './seasonal.js';

/**
 * Bake the read-only aggregate data into static JSON for a pure-static deploy (Vercel/Netlify).
 * Three files under `out` (the web's public/data dir):
 *   managers.json — every manager with a top-division title + their embedded title cabinet.
 *   leagues.json  — each country's champions (season, club, manager), newest first.
 *   cups.json     — each country's national-cup roll of honour.
 * The static frontend loads these once and filters client-side; no backend/DB in production.
 *
 * Callable so the "refresh latest" script can re-bake in the same run (see scripts/refresh-latest.ts);
 * scripts/bake-static.ts is a thin wrapper over this for a standalone bake.
 */
export interface BakeResult {
  managers: number;
  leagues: number;
  champions: number;
  cups: number;
  cupFinals: number;
  masters: number;
  seasonal: number;
}

export async function bakeStatic(out: string): Promise<BakeResult> {
  mkdirSync(out, { recursive: true });

  // Managers: league titles + attributed cup wins (main/secondary), grouped by championUserId (>0).
  const users = await prisma.hattrickUser.findMany({ select: { userId: true, nationality: true, loginName: true } });
  const natById = new Map(users.map((u) => [u.userId, u.nationality]));
  // Podium coaches short of the champion are stored as IDS ONLY (see WorldCupChampion's
  // runnerUpUserId / thirdFourthUserIds) so a rename can't leave a stale copy in that table —
  // which means the bake is where their names get attached.
  const nameById = new Map(users.map((u) => [u.userId, u.loginName]));

  /**
   * A podium slot's coach, as the frontend renders one.
   *
   * An id of 0/null means nobody could be attributed — a deleted account, or no coaching tenure
   * recorded that far back. That yields an EMPTY object rather than a dropped entry, so the
   * third/fourth array stays index-aligned with the nations it describes.
   */
  const podiumCoach = (uid: number | null | undefined) =>
    uid && uid > 0 ? { userId: uid, name: nameById.get(uid) ?? undefined, nationality: natById.get(uid) ?? undefined } : {};

  /**
   * Leagues that no longer run.
   *
   * Their season numbering froze when they closed, so their final champion is NOT the reigning
   * champion of anything and none of their titles is recent — "season 7" there is years in the past
   * while a live league is on season 94. The titles were really won, so they still count all-time;
   * they are only barred from `last` and from `ago`, which is what "current" and "recent" are built
   * on (see `agoOf`).
   *
   * The list is explicit because nothing in the data marks a league as closed: worlddetails still
   * reports a currentSeason for these, equal to their last played season, so every one of the 160
   * leagues shows a zero gap between currentSeason and its newest recorded champion. There is no
   * staleness signal to detect them by.
   *
   * Checked by leagueId, which covers a closed league's CUPS as well as its championship — every
   * league's cups carry its own id (Homegrown's are on 1003, Hattrick International's on 1000). The
   * Anniversary Cup is not in the DB at all right now: cups are seeded from worlddetails, which no
   * longer lists them for a closed league. If it is ever back-filled it will arrive on 1002 and be
   * excluded without another change here.
   *
   * The other three non-country leagues (1000 Hattrick International, 1003 Homegrown,
   * 3000 Hattrick Femme International) are still running and must NOT be added.
   */
  const DEFUNCT_LEAGUE_IDS = new Set<number>([
    1002, // Hattrick Anniversary League, and its cup — both closed.
  ]);

  // Reigning champion = the winner of each competition's most recent recorded season. Computed
  // over ALL champions (including unattributed/unknown owners) so a manager's older title isn't
  // mis-tagged "current" when a later season was won by someone we can't attribute yet.
  const leagueReignSeason = new Map<number, number>();
  for (const c of await prisma.leagueChampion.findMany({ where: { complete: true }, select: { leagueId: true, season: true } })) {
    const cur = leagueReignSeason.get(c.leagueId);
    if (cur === undefined || c.season > cur) leagueReignSeason.set(c.leagueId, c.season);
  }
  const cupReignSeason = new Map<number, number>();
  for (const c of await prisma.cupChampion.findMany({ select: { cupId: true, season: true } })) {
    const cur = cupReignSeason.get(c.cupId);
    if (cur === undefined || c.season > cur) cupReignSeason.set(c.cupId, c.season);
  }

  /**
   * How many of a competition's own instalments back a trophy is: 0 = the current holder, 1 = the
   * one before it. This is what Trophy leaders' recency windows count, and the bake is the only
   * place it can be computed correctly.
   *
   * Two reasons it cannot be derived in the frontend. First, Hattrick numbers league seasons PER
   * LEAGUE from that league's founding — Italy is on 94 while Rwanda is on 6 — so there is no global
   * "season 90" to compare against, and every competition has to be measured from its own latest.
   * Second, the reign maps above are built over EVERY row, including champions never attributed to
   * a manager; managers.json carries only attributed ones, so a frontend re-derivation lands early
   * whenever a competition's most recent winner is unknown, and an older trophy then counts as
   * current. Baking it from the same anchors that decide `last` makes `ago === 0` and
   * `last` the same statement by construction.
   *
   * The World Cup and the regional cups are numbered by CYCLE rather than season, so their "5 most
   * recent" spans about ten seasons of real time. That is the deliberate trade for having the
   * one-instalment window agree exactly with "Reigning only" in every competition.
   */
  const agoOf = (latest: number | undefined, season: number) => (latest === undefined ? undefined : latest - season);

  // teamId is optional throughout: it links the cabinet entry out to the club's hattrick.org page,
  // and must stay undefined for a reconstructed placeholder (id 0) or an unresolved cup winner.
  /** `ago` = how many of this competition's own instalments back the trophy is: 0 is the current
   *  holder, 1 the one before, and so on. See `agoOf` for why the bake computes it. */
  interface CupItem { country: string; leagueId: number; season: number; club: string; teamId?: number; cup: string; last: boolean; ago?: number }
  interface Mgr {
    userId: number; userName: string; nationality: string; lg: number;
    titles: Array<{ country: string; leagueId: number; season: number; club: string; teamId?: number; last: boolean; ago?: number }>;
    cupsMain: CupItem[]; cupsSec: CupItem[]; masters: CupItem[]; seasonal: CupItem[]; worldCup: CupItem[];
  }
  const mgr = new Map<number, Mgr>();
  const get = (uid: number, name: string | null) => {
    let e = mgr.get(uid);
    if (!e) { e = { userId: uid, userName: name ?? `user ${uid}`, nationality: natById.get(uid) ?? 'Unknown', lg: 0, titles: [], cupsMain: [], cupsSec: [], masters: [], seasonal: [], worldCup: [] }; mgr.set(uid, e); }
    return e;
  };

  for (const c of await prisma.leagueChampion.findMany({
    where: { complete: true, championUserId: { gt: 0 } },
    select: { championUserId: true, championUserName: true, countryName: true, season: true, championTeamName: true, championTeamId: true, leagueId: true },
  })) {
    get(c.championUserId!, c.championUserName).titles.push({
      country: c.countryName, leagueId: c.leagueId, season: c.season, club: c.championTeamName,
      teamId: c.championTeamId > 0 ? c.championTeamId : undefined,
      last: !DEFUNCT_LEAGUE_IDS.has(c.leagueId) && leagueReignSeason.get(c.leagueId) === c.season,
      ago: DEFUNCT_LEAGUE_IDS.has(c.leagueId) ? undefined : agoOf(leagueReignSeason.get(c.leagueId), c.season),
    });
  }

  for (const c of await prisma.cupChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { championUserId: true, championUserName: true, countryName: true, leagueId: true, season: true, championTeamName: true, championTeamId: true, cupName: true, isMain: true, cupId: true },
  })) {
    const e = get(c.championUserId!, c.championUserName);
    const item = {
      country: c.countryName, leagueId: c.leagueId, season: c.season, club: c.championTeamName,
      teamId: c.championTeamId && c.championTeamId > 0 ? c.championTeamId : undefined,
      // A closed league's cups closed with it — same rule as its championship.
      cup: c.cupName, last: !DEFUNCT_LEAGUE_IDS.has(c.leagueId) && cupReignSeason.get(c.cupId) === c.season,
      ago: DEFUNCT_LEAGUE_IDS.has(c.leagueId) ? undefined : agoOf(cupReignSeason.get(c.cupId), c.season),
    };
    // The Hattrick Masters and the Seasonal Cups are each their own category, not national cups
    // (see sync/masters.ts, sync/seasonal.ts).
    if (c.cupId === MASTERS_CUP_ID) e.masters.push(item);
    else if (isSeasonalCup(c.cupId)) e.seasonal.push(item);
    else (c.isMain ? e.cupsMain : e.cupsSec).push(item);
  }

  // World Cup (senior + youth) — a champion NATION, attributed to the coach in charge at the time
  // (see sync/worldCup.ts). Lumped into one "wc" category the same way secondary cups lump
  // Emerald/Ruby/Sapphire/Consolation; the cup label on each item keeps senior vs youth visible in
  // the manager's cabinet drill-down. "Reigning" is computed per bracket (edition number), since a
  // senior and a youth edition finishing around the same time aren't really "the same" title.
  const wcReignEdition = new Map<boolean, number>();
  for (const c of await prisma.worldCupChampion.findMany({ where: { champion: { not: null } }, select: { isYouth: true, edition: true } })) {
    const cur = wcReignEdition.get(c.isYouth);
    if (cur === undefined || c.edition > cur) wcReignEdition.set(c.isYouth, c.edition);
  }
  for (const c of await prisma.worldCupChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { championUserId: true, championUserName: true, champion: true, edition: true, isYouth: true },
  })) {
    const e = get(c.championUserId!, c.championUserName);
    e.worldCup.push({
      country: 'World Cup', leagueId: 0, season: c.edition, club: c.champion!,
      cup: c.isYouth ? 'World Cup (Youth)' : 'World Cup', last: wcReignEdition.get(c.isYouth) === c.edition,
      ago: agoOf(wcReignEdition.get(c.isYouth), c.edition),
    });
  }

  // The regional national-team cups land in the SAME cabinet bucket as the World Cup — one
  // "National trophies" category, the cup label keeping each competition visible in the drill-down.
  // "Reigning" is per cup (its own latest season), the way each national cup reigns on its own.
  const ntReignSeason = new Map<number, number>();
  for (const c of await prisma.nationalCupChampion.findMany({ where: { champion: { not: null } }, select: { cupId: true, season: true } })) {
    const cur = ntReignSeason.get(c.cupId);
    if (cur === undefined || c.season > cur) ntReignSeason.set(c.cupId, c.season);
  }
  for (const c of await prisma.nationalCupChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { championUserId: true, championUserName: true, champion: true, cupId: true, cupName: true, season: true, championLeagueId: true },
  })) {
    const e = get(c.championUserId!, c.championUserName);
    e.worldCup.push({
      country: c.cupName, leagueId: c.championLeagueId ?? 0, season: c.season, club: c.champion!,
      cup: c.cupName, last: ntReignSeason.get(c.cupId) === c.season,
      ago: agoOf(ntReignSeason.get(c.cupId), c.season),
    });
  }

  // Medals — silver and bronze places in the same cups. Deliberately a SEPARATE tally from titles:
  // a runner-up is not a trophy, so these never touch `wc` or the cabinet. Both losing semi-finalists
  // count as bronze (no third-place match is played).
  const medalRows = await prisma.nationalCupChampion.findMany({
    where: { champion: { not: null } },
    select: {
      cupId: true, cupName: true, season: true, runnerUp: true, runnerUpUserId: true, runnerUpLeagueId: true,
      thirdFourth: true, thirdFourthUserIds: true, thirdFourthLeagueIds: true,
    },
  });
  // leagueId travels with each medal so the frontend can flag it by ID. Nation NAMES don't all
  // resolve — Hattrick spells them inconsistently across pages ("Bénin"/"Benin", curly vs straight
  // apostrophe in "Côte d'Ivoire") and some have no nationality entry at all — but every one of
  // them has a league id, which is stable.
  interface MedalItem { cup: string; season: number; nation: string; leagueId?: number; place: 2 | 3; ago?: number }
  const medalsByUser = new Map<number, MedalItem[]>();
  const addMedal = (uid: number | null | undefined, item: MedalItem) => {
    if (!uid || uid <= 0) return;
    const arr = medalsByUser.get(uid) ?? [];
    arr.push(item);
    medalsByUser.set(uid, arr);
  };
  // World Cup podiums too — same rule, different source. These carry no league id (History.aspx
  // names nations without linking them), so the frontend falls back to the name for the flag.
  for (const e of await prisma.worldCupChampion.findMany({
    where: { champion: { not: null } },
    select: { isYouth: true, edition: true, runnerUp: true, runnerUpUserId: true, thirdFourth: true, thirdFourthUserIds: true },
  })) {
    const cup = e.isYouth ? 'World Cup (Youth)' : 'World Cup';
    const ago = agoOf(wcReignEdition.get(e.isYouth), e.edition);
    addMedal(e.runnerUpUserId, { cup, season: e.edition, nation: e.runnerUp ?? '', place: 2, ago });
    const wcThirds = (e.thirdFourth || '').split(', ').filter(Boolean);
    (e.thirdFourthUserIds || '').split(',').forEach((raw, i) => {
      const uid = Number(raw);
      if (uid) addMedal(uid, { cup, season: e.edition, nation: wcThirds[i] ?? '', place: 3, ago });
    });
  }

  for (const r of medalRows) {
    const ago = agoOf(ntReignSeason.get(r.cupId), r.season);
    addMedal(r.runnerUpUserId, {
      cup: r.cupName, season: r.season, nation: r.runnerUp ?? '', leagueId: r.runnerUpLeagueId ?? undefined, place: 2, ago,
    });
    const names = (r.thirdFourth || '').split(', ').filter(Boolean);
    const leagueIds = (r.thirdFourthLeagueIds || '').split(',');
    (r.thirdFourthUserIds || '').split(',').forEach((raw, i) => {
      const uid = Number(raw);
      if (uid) addMedal(uid, {
        cup: r.cupName, season: r.season, nation: names[i] ?? '', leagueId: Number(leagueIds[i]) || undefined, place: 3, ago,
      });
    });
  }
  // A medallist who never won anything still belongs in managers.json, so seed an entry for them —
  // `get` creates one on demand and the name comes from HattrickUser (attribution upserts it).
  const medalUserNames = new Map(
    (await prisma.hattrickUser.findMany({ where: { userId: { in: [...medalsByUser.keys()] } }, select: { userId: true, loginName: true } }))
      .map((u) => [u.userId, u.loginName]),
  );
  for (const uid of medalsByUser.keys()) get(uid, medalUserNames.get(uid) ?? null);

  const bySeasonDesc = <T extends { season: number }>(a: T, b: T) => b.season - a.season;
  const managers = [...mgr.values()]
    .map((m) => ({
      userId: m.userId,
      userName: m.userName,
      nationality: m.nationality,
      lg: m.titles.length,
      main: m.cupsMain.length,
      sec: m.cupsSec.length,
      hm: m.masters.length,
      sn: m.seasonal.length,
      wc: m.worldCup.length,
      // Medals ride alongside the title counts, never inside them (see the medal tally above).
      wcSilver: (medalsByUser.get(m.userId) ?? []).filter((x) => x.place === 2).length,
      wcBronze: (medalsByUser.get(m.userId) ?? []).filter((x) => x.place === 3).length,
      medals: (medalsByUser.get(m.userId) ?? []).sort((a, b) => b.season - a.season),
      lgLast: m.titles.filter((t) => t.last).length,
      mainLast: m.cupsMain.filter((c) => c.last).length,
      secLast: m.cupsSec.filter((c) => c.last).length,
      hmLast: m.masters.filter((c) => c.last).length,
      snLast: m.seasonal.filter((c) => c.last).length,
      wcLast: m.worldCup.filter((c) => c.last).length,
      titles: m.titles.sort(bySeasonDesc),
      cupsMain: m.cupsMain.sort(bySeasonDesc),
      cupsSec: m.cupsSec.sort(bySeasonDesc),
      masters: m.masters.sort(bySeasonDesc),
      seasonal: m.seasonal.sort(bySeasonDesc),
      worldCup: m.worldCup.sort(bySeasonDesc),
    }))
    .sort((a, b) => b.lg + b.main + b.sec + b.hm + b.sn + b.wc - (a.lg + a.main + a.sec + a.hm + a.sn + a.wc) || b.hm - a.hm || b.wc - a.wc || b.lg - a.lg);
  writeFileSync(`${out}/managers.json`, JSON.stringify(managers));

  // Guardrail: a user may appear in the bake with an unresolved nationality (null in the DB →
  // "Unknown") if a scrape upserted them without ever running the nationality pass. Surface it
  // loudly on EVERY bake — including token-less paths that can't resolve it themselves — so the gap
  // can't silently reach production. Warn, don't throw.
  //
  // NB: this deliberately looks beyond `mgr`, which only holds users who won a TITLE. Election
  // winners are upserted by ingestElections with a login name and nothing else, and most never won
  // anything, so checking `mgr` alone reported a clean bake while 583 of them had no nationality —
  // dropping 1,261 elections out of the by-nationality aggregation with no warning at all.
  const electionWinnerIds = (
    await prisma.nationalCoachElection.findMany({
      where: { winnerUserId: { not: null } },
      select: { winnerUserId: true },
      distinct: ['winnerUserId'],
    })
  ).map((r) => r.winnerUserId!);
  const bakedUserIds = new Set<number>([...mgr.keys(), ...electionWinnerIds]);
  const unresolvedNat = [...bakedUserIds].filter((uid) => natById.get(uid) == null).length;
  if (unresolvedNat > 0) {
    console.warn(
      `⚠ bake: ${unresolvedNat} baked user(s) have no nationality (shown as "Unknown", and left out ` +
        `of by-nationality aggregations). Run \`npm run backfill:nationalities -w server\` to resolve ` +
        `them, then re-bake.`,
    );
  }

  // Leagues: champions (complete), newest first. Includes the non-country leagues (Hattrick
  // International / Homegrown / Femme) — only leagues that actually have champions are emitted below.
  const leaguesRows = await prisma.nationalLeague.findMany({ select: { leagueId: true, countryName: true } });
  const allChamps = await prisma.leagueChampion.findMany({
    where: { complete: true },
    orderBy: { season: 'desc' },
    select: { leagueId: true, season: true, championTeamName: true, championUserName: true, championTeamId: true, championUserId: true },
  });
  // Link out to hattrick.org only for a REAL id — reconstructed placeholders (teamId 0) and the
  // UNKNOWN(0) attribution sentinel must never render as a link to team/manager "0".
  const byLeague = new Map<number, Array<{ season: number; club: string; manager: string; teamId?: number; userId?: number }>>();
  for (const c of allChamps) {
    const a = byLeague.get(c.leagueId) ?? [];
    a.push({
      season: c.season, club: c.championTeamName, manager: c.championUserName ?? '—',
      teamId: c.championTeamId > 0 ? c.championTeamId : undefined,
      userId: c.championUserId && c.championUserId > 0 ? c.championUserId : undefined,
    });
    byLeague.set(c.leagueId, a);
  }
  const leagues = leaguesRows
    .map((l) => ({ leagueId: l.leagueId, country: l.countryName, champions: byLeague.get(l.leagueId) ?? [] }))
    .filter((l) => l.champions.length > 0)
    .sort((a, b) => a.country.localeCompare(b.country));
  writeFileSync(`${out}/leagues.json`, JSON.stringify(leagues));
  const titleTotal = leagues.reduce((n, l) => n + l.champions.length, 0);

  // Cups: per-country roll of honour for the five national-level cups (one main + four secondary).
  // Manager comes from CupChampion.championUserId — set for league+cup doubles now, and filled by
  // the ownership-history scrape for the rest.
  const cupRows = await prisma.cup.findMany({ orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }] });
  const cupWins = await prisma.cupChampion.findMany({
    orderBy: { season: 'desc' },
    select: { cupId: true, season: true, championTeamName: true, championUserName: true, championTeamId: true, championUserId: true },
  });
  const winsByCup = new Map<number, Array<{ season: number; club: string; manager: string; teamId?: number; userId?: number }>>();
  for (const w of cupWins) {
    const a = winsByCup.get(w.cupId) ?? [];
    a.push({
      season: w.season, club: w.championTeamName, manager: w.championUserName ?? '—',
      teamId: w.championTeamId && w.championTeamId > 0 ? w.championTeamId : undefined,
      userId: w.championUserId && w.championUserId > 0 ? w.championUserId : undefined,
    });
    winsByCup.set(w.cupId, a);
  }

  interface CupOut { cupId: number; cupName: string; isMain: boolean; cupLevel: number; cupLevelIndex: number; winners: Array<{ season: number; club: string; manager: string; teamId?: number; userId?: number }> }
  const cupsByLeague = new Map<number, { leagueId: number; country: string; cups: CupOut[] }>();
  for (const c of cupRows) {
    if (c.cupId === MASTERS_CUP_ID || isSeasonalCup(c.cupId)) continue; // global categories, not national cups
    const winners = winsByCup.get(c.cupId) ?? [];
    if (winners.length === 0) continue;
    let e = cupsByLeague.get(c.leagueId);
    if (!e) { e = { leagueId: c.leagueId, country: c.countryName, cups: [] }; cupsByLeague.set(c.leagueId, e); }
    e.cups.push({ cupId: c.cupId, cupName: c.cupName, isMain: c.isMain, cupLevel: c.cupLevel, cupLevelIndex: c.cupLevelIndex, winners });
  }
  const cups = [...cupsByLeague.values()].sort((a, b) => a.country.localeCompare(b.country));
  writeFileSync(`${out}/cups.json`, JSON.stringify(cups));
  const cupTitleTotal = cups.reduce((n, l) => n + l.cups.reduce((m, c) => m + c.winners.length, 0), 0);

  // Hattrick Masters: the global roll of honour (season → winner), newest first, as its own file.
  const mastersWinners = winsByCup.get(MASTERS_CUP_ID) ?? [];
  writeFileSync(`${out}/masters.json`, JSON.stringify(mastersWinners));

  // Seasonal Cups: each global recurring tournament's roll of honour (e.g. Supporter Week Trophy),
  // keyed by the tournament's own season. One entry per seasonal cup, so more can be added later.
  const seasonalRolls = cupRows
    .filter((c) => isSeasonalCup(c.cupId))
    .map((c) => ({ cupId: c.cupId, cupName: c.cupName, winners: winsByCup.get(c.cupId) ?? [] }))
    .filter((c) => c.winners.length > 0);
  writeFileSync(`${out}/seasonal.json`, JSON.stringify(seasonalRolls));
  const seasonalTotal = seasonalRolls.reduce((n, c) => n + c.winners.length, 0);

  // World Cup (senior + youth): champion is a NATION, not a manager/club — see sync/worldCup.ts.
  // Scraped once (no CHPP path), stored in its own table, baked as its own file.
  const wcRows = await prisma.worldCupChampion.findMany({ orderBy: [{ isYouth: 'asc' }, { edition: 'asc' }] });
  const wcOut = (r: (typeof wcRows)[number]) => {
    // Built from the NATIONS array so the coach slots can't drift out of alignment: the two columns
    // are stored with different separators (', ' vs ',') and an all-empty id string would otherwise
    // split to one element against zero nations.
    const thirdFourth = r.thirdFourth ? r.thirdFourth.split(', ') : [];
    const tfIds = (r.thirdFourthUserIds || '').split(',');
    const ru = podiumCoach(r.runnerUpUserId);
    return {
      edition: r.edition,
      ageGroup: r.ageGroup ?? undefined,
      host: r.host,
      finished: r.finishedDate,
      champion: r.champion,
      runnerUp: r.runnerUp,
      thirdFourth,
      coachUserId: r.championUserId && r.championUserId > 0 ? r.championUserId : undefined,
      coach: r.championUserName ?? undefined,
      coachNationality: r.championUserId ? natById.get(r.championUserId) : undefined,
      // The rest of the podium's coaches. A medal is not a trophy — these never reach a manager's
      // title count — but the roll should still say who lost the final and the semis.
      runnerUpCoachUserId: ru.userId,
      runnerUpCoach: ru.name,
      runnerUpCoachNationality: ru.nationality,
      thirdFourthCoaches: thirdFourth.map((_, i) => podiumCoach(Number(tfIds[i]) || 0)),
    };
  };
  // The regional national-team cups (Africa/America/Asia and Oceania/Europe/Nations) ride in the
  // same file under `regional`: same nature as the World Cup, but perpetual — one champion per
  // SEASON per cup, so each is its own roll of honour rather than a numbered edition list. The
  // World Cup's own cupId is never in this table (see sync/ntCups.ts), so nothing double-counts.
  const ntRows = await prisma.nationalCupChampion.findMany({ orderBy: [{ cupName: 'asc' }, { season: 'desc' }] });
  const regionalByCup = new Map<number, { cupId: number; cupName: string; isYouth: boolean; seasons: unknown[] }>();
  for (const r of ntRows) {
    const cup = regionalByCup.get(r.cupId) ?? { cupId: r.cupId, cupName: r.cupName, isYouth: r.isYouth, seasons: [] };
    // Same alignment rule as wcOut above — index off the nations, never off the id string.
    const thirdFourth = r.thirdFourth ? r.thirdFourth.split(', ') : [];
    const tfIds = (r.thirdFourthUserIds || '').split(',');
    const ru = podiumCoach(r.runnerUpUserId);
    cup.seasons.push({
      season: r.season,
      host: r.host,
      finished: r.finalDate,
      status: r.status ?? undefined,
      champion: r.champion,
      runnerUp: r.runnerUp,
      thirdFourth,
      // League ids for the whole podium, so the frontend flags every nation by ID rather than by a
      // name that Hattrick spells inconsistently (see flags.ts nationFlagUrl).
      championLeagueId: r.championLeagueId ?? undefined,
      runnerUpLeagueId: r.runnerUpLeagueId ?? undefined,
      thirdFourthLeagueIds: (r.thirdFourthLeagueIds || '').split(',').map((s) => Number(s) || 0),
      coachUserId: r.championUserId && r.championUserId > 0 ? r.championUserId : undefined,
      coach: r.championUserName ?? undefined,
      coachNationality: r.championUserId ? natById.get(r.championUserId) : undefined,
      runnerUpCoachUserId: ru.userId,
      runnerUpCoach: ru.name,
      runnerUpCoachNationality: ru.nationality,
      thirdFourthCoaches: thirdFourth.map((_, i) => podiumCoach(Number(tfIds[i]) || 0)),
    });
    regionalByCup.set(r.cupId, cup);
  }
  const worldCup = {
    senior: wcRows.filter((r) => !r.isYouth).map(wcOut),
    youth: wcRows.filter((r) => r.isYouth).map(wcOut),
    regional: [...regionalByCup.values()],
  };
  writeFileSync(`${out}/worldcup.json`, JSON.stringify(worldCup));

  // National Coach elections — per-country, independent of World Cup outcome (see sync/elections.ts).
  const electionRows = await prisma.nationalCoachElection.findMany({ orderBy: [{ countryName: 'asc' }, { edition: 'asc' }] });
  const elections = electionRows.map((r) => ({
    leagueId: r.leagueId,
    countryName: r.countryName,
    edition: r.edition,
    host: r.host,
    // Only carried when true — the senior election is the default and would otherwise add a false
    // to every one of ~3,500 rows in the shipped JSON.
    isYouth: r.isYouth || undefined,
    winnerUserId: r.winnerUserId ?? undefined,
    winner: r.winnerUserName ?? undefined,
    winnerNationality: r.winnerUserId ? natById.get(r.winnerUserId) : undefined,
    votes: r.votes ?? undefined,
  }));
  writeFileSync(`${out}/elections.json`, JSON.stringify(elections));

  return {
    managers: managers.length, leagues: leagues.length, champions: titleTotal, cups: cups.length,
    cupFinals: cupTitleTotal, masters: mastersWinners.length, seasonal: seasonalTotal,
  };
}
