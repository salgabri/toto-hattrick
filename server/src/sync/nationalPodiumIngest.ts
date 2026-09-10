/** Historical podium facts are fill-only. A partial scrape cannot erase a nation, change its
 * linked coach, or reorder joint bronze slots. Conflicting facts need an explicit review. */
export function mergeNationalPodiumFacts<T extends Record<string, unknown>>(stored: Record<string, unknown>, incoming: T): { data: Partial<T>; conflicts: string[] } {
  const data: Partial<T> = {};
  const conflicts: string[] = [];
  const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== 0;
  for (const key of Object.keys(incoming) as Array<keyof T & string>) {
    const value = incoming[key];
    if (!present(value)) continue;
    const old = stored[key];
    if (/^(champion|runnerUp)(Team|League)Id$/.test(key)) {
      const nationKey = key.startsWith('champion') ? 'champion' : 'runnerUp';
      if (!Number.isSafeInteger(value) || Number(value) <= 0 || !present(incoming[nationKey]) || (present(stored[nationKey]) && stored[nationKey] !== incoming[nationKey])) {
        conflicts.push(key);
        continue;
      }
    }
    if (key === 'status') {
      // Completion can advance but an old/incomplete page must not reopen a finished cup.
      if (!present(old) || String(value).toLowerCase() === 'finished') data[key] = value;
      continue;
    }
    if (key === 'thirdFourthTeamIds' || key === 'thirdFourthLeagueIds') {
      if (!incoming.thirdFourth || (stored.thirdFourth && stored.thirdFourth !== incoming.thirdFourth)) {
        conflicts.push(key);
        continue;
      }
      const prior = String(old ?? '').split(',');
      const next = String(value).split(',');
      if ([...prior, ...next].some((v) => v && v !== '0' && (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) <= 0))) {
        conflicts.push(key);
        continue;
      }
      const merged = Array.from({ length: Math.max(prior.length, next.length) }, (_, index) => {
        const before = prior[index] ?? '', after = next[index] ?? '';
        if (before && before !== '0' && after && after !== '0' && before !== after) conflicts.push(key);
        return before && before !== '0' ? before : after;
      });
      data[key] = merged.join(',') as T[typeof key];
    } else if (!present(old)) {
      // Orphaned ownership/identity must not get attached to a newly supplied nation.
      const companions = key === 'champion' ? ['championUserId', 'championTeamId', 'championLeagueId']
        : key === 'runnerUp' ? ['runnerUpUserId', 'runnerUpTeamId', 'runnerUpLeagueId']
        : key === 'thirdFourth' ? ['thirdFourthUserIds', 'thirdFourthTeamIds', 'thirdFourthLeagueIds'] : [];
      if (companions.some((field) => String(stored[field] ?? '').split(',').some((v) => v !== '' && v !== '0'))) conflicts.push(key);
      else data[key] = value;
    } else if (old !== value) conflicts.push(key);
  }
  return { data: conflicts.length ? {} : data, conflicts: [...new Set(conflicts)] };
}

/** IDs without an index-aligned nation list cannot safely refresh an older scrape. */
export function validNationalBronzeInput(names: string[] | undefined, ...ids: Array<Array<number | null> | undefined>): boolean {
  return ids.every((values) => !values || (!!names && values.length <= names.length && values.every((value) => value === null || (Number.isSafeInteger(value) && value > 0))));
}
