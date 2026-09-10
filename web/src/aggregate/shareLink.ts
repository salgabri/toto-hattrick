import {
  bracketParam, competitionsParam, countParam, cupCategoryParam, cupIdParam, electionTabParam,
  medalByParam, medalScopeParam, nationParam, recencyParam, textParam, trophyGroupParam, viewParam,
} from './filterParams.js';
import type { UrlCodec } from './urlState.js';

/** Share the visible page and its filters, without carrying along other tabs' remembered state. */
export function buildShareUrl(href: string): string {
  const source = new URL(href);
  const shared = new URL(source.origin);
  shared.pathname = source.pathname;
  const view = viewParam.parse(source.searchParams.get('view'));
  // An explicit view makes even the default page self-contained.
  shared.searchParams.set('view', view);

  function copy<T>(filter: string, codec: UrlCodec<T>): T {
    const key = `${view}.${filter}`;
    const value = codec.parse(source.searchParams.get(key));
    const formatted = codec.format(value);
    if (formatted !== null) shared.searchParams.set(key, formatted);
    return value;
  }

  switch (view) {
    case 'trophies': {
      const group = copy('group', trophyGroupParam);
      if (group === 'manager') copy('nation', nationParam);
      copy('q', textParam);
      copy('competitions', competitionsParam);
      const recency = copy('recency', recencyParam);
      if (recency !== 'reigning') copy('count', countParam);
      break;
    }
    case 'leagues':
      copy('country', textParam);
      break;
    case 'cups': {
      const category = copy('category', cupCategoryParam);
      if (category === 'main' || category === 'secondary') copy('country', textParam);
      if (category === 'secondary') copy('secondary', cupIdParam);
      if (category === 'seasonal') copy('seasonal', cupIdParam);
      break;
    }
    case 'worldcup':
      copy('bracket', bracketParam);
      copy('competition', textParam);
      break;
    case 'medals': {
      const scope = copy('scope', medalScopeParam);
      copy('by', medalByParam);
      if (scope === 'one') {
        copy('bracket', bracketParam);
        copy('competition', textParam);
      }
      break;
    }
    case 'elections': {
      const tab = copy('tab', electionTabParam);
      copy(tab === 'countries' ? 'country' : 'q', textParam);
      break;
    }
  }

  return shared.href;
}
