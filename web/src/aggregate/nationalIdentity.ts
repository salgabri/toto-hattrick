import { LEAGUE_ISO, NATIONALITY_ISO } from './flags.js';

/** A national team's country is shared by its senior and youth squads. League IDs bridge the
 * regional cups' native names to the World Cup's name-only history. Keep the display name separate
 * from the key so aliases and the U21 prefix cannot divide one country's medal total. */
export function nationalIdentity(nation: string, leagueId?: number): { key: string; name: string } {
  const name = nation.replace(/^U21\s+/, '');
  const country = (leagueId && LEAGUE_ISO[leagueId]) || NATIONALITY_ISO[name];
  return { key: country ? `country:${country}` : `name:${name}`, name };
}
