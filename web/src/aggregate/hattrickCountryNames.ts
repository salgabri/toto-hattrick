import nationalTeamIds from '../../../server/src/data/national-team-ids.json' with { type: 'json' };
import { LEAGUE_ISO, NATIONALITY_ISO } from './flags.js';

export type CountryNameStyle = 'hattrick' | 'english';

// The registry keys come from CHPP worlddetails.LeagueName; league IDs keep display names
// independent of the English names in the historical snapshot and its cross-file joins.
const namesByLeagueId = new Map<number, string>(
  Object.entries(nationalTeamIds).map(([name, ids]) => [ids.leagueId, name]),
);

export function countryDisplayName(leagueId: number | undefined, englishName: string, style: CountryNameStyle): string {
  return style === 'hattrick' && leagueId !== undefined ? namesByLeagueId.get(leagueId) ?? englishName : englishName;
}

interface EnglishCountry {
  code: string;
  name: string;
}

// Nationality strings are not always the same as worlddetails.LeagueName. Accept both sets of
// Hattrick names, including newer leagues absent from the older nationality/flag registry.
const isoByNationality = new Map<string, string>(Object.entries(NATIONALITY_ISO));
for (const [name, ids] of Object.entries(nationalTeamIds)) {
  const iso = LEAGUE_ISO[ids.leagueId];
  if (iso) isoByNationality.set(name, iso);
}
// Hattrick has used both apostrophe glyphs in Côte d'Ivoire across its pages.
isoByNationality.set("Côte d'Ivoire", 'ci');

/** Change only a nationality label; the raw nationality remains the filter/grouping key. */
export function nationalityDisplayName(
  nationality: string,
  style: CountryNameStyle,
  englishCountries: readonly EnglishCountry[],
): string {
  return nationDisplayName(nationality, style, englishCountries);
}

/** Display a national team's country, retaining the U21 bracket and any raw identity key. */
export function nationDisplayName(
  nation: string,
  style: CountryNameStyle,
  englishCountries: readonly EnglishCountry[],
  leagueId?: number,
): string {
  const prefix = nation.match(/^U21\s+/)?.[0] ?? '';
  const rawCountry = nation.slice(prefix.length);
  if (style === 'hattrick') {
    return leagueId === undefined ? nation : `${prefix}${countryDisplayName(leagueId, rawCountry, style)}`;
  }
  if (leagueId !== undefined) {
    const byId = englishCountries.find((country) => Number(country.code) === leagueId)?.name;
    if (byId) return `${prefix}${byId}`;
  }
  const iso = (leagueId !== undefined && LEAGUE_ISO[leagueId]) || isoByNationality.get(rawCountry);
  if (!iso) return nation;
  const english = englishCountries.find((country) => LEAGUE_ISO[Number(country.code)] === iso)?.name;
  return english ? `${prefix}${english}` : nation;
}
