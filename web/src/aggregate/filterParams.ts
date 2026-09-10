import { enumParam, positiveIntParam, stringParam, type UrlCodec } from './urlState.js';

export const viewParam = enumParam(['trophies', 'leagues', 'cups', 'worldcup', 'medals', 'elections'], 'trophies');
export const textParam = stringParam();
export const nationParam = stringParam('ALL');
export const recencyParam = enumParam(['all', 'reigning', '5', '10', '20'], 'all');
export const countParam = enumParam(['winners', 'medals'], 'winners');
export const trophyGroupParam = enumParam(['manager', 'nation'], 'manager');
export const cupCategoryParam = enumParam(['main', 'secondary', 'masters', 'seasonal'], 'main');
export const cupIdParam = positiveIntParam();
export const bracketParam = enumParam(['senior', 'youth'], 'senior');
export const medalScopeParam = enumParam(['one', 'senior', 'u21', 'all'], 'senior');
export const medalByParam = enumParam(['nation', 'coach', 'coachNation'], 'nation');
export const electionTabParam = enumParam(['managers', 'nations', 'countries'], 'managers');

const competitionKeys = ['champ', 'main', 'sec', 'hm', 'sn', 'wc'] as const;
type IncludedCompetitions = Record<(typeof competitionKeys)[number], boolean>;
const defaultCompetitions: IncludedCompetitions = { champ: true, main: true, sec: false, hm: true, sn: true, wc: true };
const included = (value: IncludedCompetitions) => competitionKeys.filter((key) => value[key]).join(',');

export const competitionsParam: UrlCodec<IncludedCompetitions> = {
  parse(value) {
    if (value === null) return defaultCompetitions;
    // An explicit empty list means every competition is off; missing means the usual defaults.
    const selected = value === '' ? [] : value.split(',');
    if (selected.some((key) => !competitionKeys.some((known) => known === key))) return defaultCompetitions;
    return Object.fromEntries(competitionKeys.map((key) => [key, selected.includes(key)])) as IncludedCompetitions;
  },
  format(value) {
    const selected = included(value);
    return selected === included(defaultCompetitions) ? null : selected;
  },
};
