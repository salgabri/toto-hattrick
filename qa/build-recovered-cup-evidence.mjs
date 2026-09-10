import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
const root = new URL('../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root)));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
const gaps = read('qa/live-cup-gap-results.json').checks;
const rounds = read('qa/cup-final-earlier-rounds.json').checks;
const select = (o, keys) => Object.fromEntries(keys.map(key => [key, o[key]]));
const entries = gaps.map(g => {
  const xml = readFileSync(new URL(`server/samples/matchdetails-3.0-${g.matchId}.local.xml`, root), 'utf8');
  const raw = parser.parse(xml).HattrickData.Match;
  const match = select(raw, ['MatchID', 'MatchType', 'MatchContextId', 'MatchDate', 'FinishedDate']);
  match.HomeTeam = select(raw.HomeTeam, ['HomeTeamID', 'HomeTeamName', 'HomeGoals']);
  match.AwayTeam = select(raw.AwayTeam, ['AwayTeamID', 'AwayTeamName', 'AwayGoals']);
  const events = [raw.EventList?.Event ?? []].flat().filter(e => [70, 71, 72, 500, 599].includes(+e.EventTypeID))
    .map(e => select(e, ['Minute', 'SubjectTeamID', 'MatchPart', 'EventTypeID', 'EventText']));
  if (events.length) match.EventList = { Event: events };
  const summary = select(g, ['cupId', 'season', 'round', 'matchId', 'homeTeamName', 'awayTeamName', 'homeGoals', 'awayGoals']);
  const previous = rounds.find(r => r.requested.cupId === g.cupId && r.requested.season === g.season).response;
  const rawMatch = { HattrickData: { Match: match } };
  if ([18279050, 541334258].includes(g.matchId)) writeFileSync(new URL(`server/samples/cup-final-${g.matchId}-3.0.xml`, root), '<?xml version="1.0" encoding="utf-8"?>\n' + builder.build(rawMatch));
  return { summary, previous, rawMatch,
    sourceURLs: [
      `https://chpp.hattrick.org/chppxml.ashx?file=cupmatches&version=1.2&cupId=${g.cupId}&season=${g.season}&cupRound=${g.round}`,
      `https://chpp.hattrick.org/chppxml.ashx?file=cupmatches&version=1.2&cupId=${g.cupId}&season=${g.season}&cupRound=${g.round - 1}`,
      `https://chpp.hattrick.org/chppxml.ashx?file=matchdetails&version=3.0&matchID=${g.matchId}`,
    ], captureSha256: createHash('sha256').update(xml).digest('hex'),
  };
});
writeFileSync(new URL('server/src/data/recovered-cup-final-evidence.json', root), JSON.stringify({ capturedAt: new Date().toISOString(), method: 'Previously omitted finals: CHPP last and preceding round plus matchdetails. Two-leg aggregates are primary evidence; no current ownership attribution.', entries }, null, 2));
console.log(`Prepared ${entries.length} sanitized, source-linked final evidence records`);
