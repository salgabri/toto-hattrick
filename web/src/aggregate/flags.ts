/**
 * Country flags for the Aggregate views.
 *
 * Hattrick names countries two incompatible ways, so we key two maps:
 *   NATIONALITY_ISO — manager nationality strings, in the country's OWN language
 *                     ("Deutschland", "Nippon", "Hanguk") → ISO 3166-1 alpha-2.
 *   LEAGUE_ISO      — league country by stable numeric leagueId → ISO alpha-2.
 *
 * Codes are lowercase ISO 3166-1 alpha-2, plus the UK home-nation subdivisions
 * (gb-eng/gb-sct/gb-wls/gb-nir). Countries with no real flag (Hattrick's regional "Oceania"
 * league, the international leagues) are simply absent — a missing key renders nothing rather
 * than a broken image.
 *
 * Flags are SELF-HOSTED under web/public/flags/{code}.svg (sourced from the `flag-icons`
 * package — regenerate with `npm run flags:sync -w web`). No external CDN at runtime, so the
 * static archive stays fully self-contained. Emoji flags were rejected: Windows/Chrome render
 * them as bare letter pairs, not flags.
 */

// native nationality name -> flagcdn code.
export const NATIONALITY_ISO: Record<string, string> = {
  'Al Iraq': 'iq', 'Al Kuwayt': 'kw', 'Al Maghrib': 'ma', 'Al Urdun': 'jo', 'Al Yaman': 'ye',
  'Algérie': 'dz', Andorra: 'ad', Angola: 'ao', Argentina: 'ar', Armenia: 'am',
  'Azərbaycan': 'az', Bahrain: 'bh', Bangladesh: 'bd', Barbados: 'bb', Belarus: 'by',
  Belgium: 'be', Benin: 'bj', Bolivia: 'bo', 'Bosna i Hercegovina': 'ba', Brasil: 'br',
  Brunei: 'bn', Bulgaria: 'bg', 'Cabo Verde': 'cv', Cameroon: 'cm', Canada: 'ca',
  Chile: 'cl', China: 'cn', 'Chinese Taipei': 'tw', Colombia: 'co', 'Costa Rica': 'cr',
  'Crna Gora': 'me', Cuba: 'cu', Cymru: 'gb-wls', Cyprus: 'cy', 'Côte d’Ivoire': 'ci',
  'DR Congo': 'cd', Danmark: 'dk', Deutschland: 'de', 'Dhivehi Raajje': 'mv', Ecuador: 'ec',
  Eesti: 'ee', 'El Salvador': 'sv', England: 'gb-eng', 'España': 'es', Ethiopia: 'et',
  France: 'fr', 'Føroyar': 'fo', Ghana: 'gh', Guam: 'gu', Guatemala: 'gt',
  Hanguk: 'kr', Hellas: 'gr', Honduras: 'hn', 'Hong Kong, China': 'hk', Hrvatska: 'hr',
  India: 'in', Indonesia: 'id', Iran: 'ir', Ireland: 'ie', Israel: 'il',
  Italia: 'it', Jamaica: 'jm', Kampuchea: 'kh', Kazakhstan: 'kz', Kenya: 'ke',
  'Kyrgyz Republic': 'kg', Latvija: 'lv', Lebanon: 'lb', Liechtenstein: 'li', Lietuva: 'lt',
  'Lëtzebuerg': 'lu', 'Magyarország': 'hu', Malaysia: 'my', Malta: 'mt', Misr: 'eg',
  Moldova: 'md', 'Mongol Uls': 'mn', 'Moçambique': 'mz', Myanmar: 'mm', 'México': 'mx',
  Nederland: 'nl', Nepal: 'np', Nicaragua: 'ni', Nigeria: 'ng', Nippon: 'jp',
  Norge: 'no', 'Northern Ireland': 'gb-nir', Oman: 'om', Pakistan: 'pk', Palestine: 'ps',
  'Panamá': 'pa', Paraguay: 'py', 'Perú': 'pe', Pilipinas: 'ph', Polska: 'pl',
  Portugal: 'pt', 'Prathet Thai': 'th', 'Puerto Rico': 'pr', Qatar: 'qa', 'República Dominicana': 'do',
  'România': 'ro', Rossiya: 'ru', Sakartvelo: 'ge', 'Saudi Arabia': 'sa', Schweiz: 'ch',
  Scotland: 'gb-sct', 'Severna Makedonija': 'mk', 'Shqipëria': 'al', Singapore: 'sg', Slovenija: 'si',
  Slovensko: 'sk', 'South Africa': 'za', Srbija: 'rs', Suomi: 'fi', Suriname: 'sr',
  Suriyah: 'sy', Sverige: 'se', 'Sénégal': 'sn', Tanzania: 'tz', Tounes: 'tn',
  'Trinidad & Tobago': 'tt', 'Türkiye': 'tr', USA: 'us', Uganda: 'ug', Ukraina: 'ua',
  'United Arab Emirates': 'ae', Uruguay: 'uy', Uzbekistan: 'uz', Venezuela: 've', 'Việt Nam': 'vn',
  Zambia: 'zm', 'Ísland': 'is', 'Österreich': 'at', 'Česko': 'cz',
};

// leagueId -> flagcdn code. (Non-country leagues 15/1000/1003/3000 have no flag → omitted.)
export const LEAGUE_ISO: Record<number, string> = {
  1: 'se', 2: 'gb-eng', 3: 'de', 4: 'it', 5: 'fr', 6: 'mx', 7: 'ar', 8: 'us', 9: 'no',
  11: 'dk', 12: 'fi', 14: 'nl', 16: 'br', 17: 'ca', 18: 'cl', 19: 'co', 20: 'in', 21: 'ie',
  22: 'jp', 23: 'pe', 24: 'pl', 25: 'pt', 26: 'gb-sct', 27: 'za', 28: 'uy', 29: 've', 30: 'kr',
  31: 'th', 32: 'tr', 33: 'eg', 34: 'cn', 35: 'ru', 36: 'es', 37: 'ro', 38: 'is', 39: 'at',
  44: 'be', 45: 'my', 46: 'ch', 47: 'sg', 50: 'gr', 51: 'hu', 52: 'cz', 53: 'lv', 54: 'id',
  55: 'ph', 56: 'ee', 57: 'rs', 58: 'hr', 59: 'hk', 60: 'tw', 61: 'gb-wls', 62: 'bg', 63: 'il',
  64: 'si', 66: 'lt', 67: 'sk', 68: 'ua', 69: 'ba', 70: 'vn', 71: 'pk', 72: 'py', 73: 'ec',
  74: 'bo', 75: 'ng', 76: 'fo', 77: 'ma', 79: 'sa', 80: 'tn', 81: 'cr', 83: 'ae', 84: 'lu',
  85: 'ir', 88: 'do', 89: 'cy', 91: 'by', 93: 'gb-nir', 94: 'jm', 95: 'ke', 96: 'pa', 97: 'mk',
  98: 'al', 99: 'hn', 100: 'sv', 101: 'mt', 102: 'kg', 103: 'md', 104: 'ge', 105: 'ad', 106: 'jo',
  107: 'gt', 110: 'tt', 111: 'ni', 112: 'kz', 113: 'sr', 117: 'li', 118: 'dz', 119: 'mn', 120: 'lb',
  121: 'sn', 122: 'am', 123: 'bh', 124: 'bb', 125: 'cv', 126: 'ci', 127: 'kw', 128: 'iq', 129: 'az',
  130: 'ao', 131: 'me', 132: 'bd', 133: 'ye', 134: 'om', 135: 'mz', 136: 'bn', 137: 'gh', 138: 'kh',
  139: 'bj', 140: 'sy', 141: 'qa', 142: 'tz', 143: 'ug', 144: 'mv', 145: 'uz', 146: 'cm', 147: 'cu',
  148: 'ps', 149: 'st', 151: 'km', 152: 'lk', 153: 'cw', 154: 'gu', 155: 'cd', 156: 'et', 157: 'vc',
  158: 'bz', 159: 'mg', 160: 'bw', 161: 'mm', 162: 'zm', 163: 'sm', 164: 'ht', 165: 'pr', 166: 'gd',
  167: 'bf', 168: 'np', 169: 'gy', 170: 'pf', 171: 'gn', 172: 'bs', 173: 'rw', 174: 'kn', 175: 'gq',
  176: 'gi', 177: 'bt',
};

/** Self-hosted SVG URL for a code, or null when the code is empty/unknown. */
export function flagUrl(iso: string | undefined | null): string | null {
  return iso ? `/flags/${iso}.svg` : null;
}

/** Flag URL for a manager nationality string (native-language name), or null. */
export function nationalityFlagUrl(nationality: string | undefined | null): string | null {
  return nationality ? flagUrl(NATIONALITY_ISO[nationality]) : null;
}

/** Flag URL for a league by id, or null. */
export function leagueFlagUrl(leagueId: number | string | undefined | null): string | null {
  if (leagueId == null || leagueId === '') return null;
  return flagUrl(LEAGUE_ISO[Number(leagueId)]);
}
