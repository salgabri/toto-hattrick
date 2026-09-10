import { useCallback, useMemo, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

export interface UrlCodec<T> {
  parse(value: string | null): T;
  format(value: T): string | null;
}

type HistoryMode = 'push' | 'replace';

const URL_STATE_EVENT = 'hattrick:url-state-change';

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(URL_STATE_EVENT, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(URL_STATE_EVENT, listener);
  };
}

function getSearch(): string {
  return window.location.search;
}

function getServerSearch(): string {
  return '';
}

/** Change related filters together so Back restores the complete previous selection. */
export function updateUrlParams(
  updates: Readonly<Record<string, string | null>>,
  history: HistoryMode = 'push',
): void {
  const url = new URL(window.location.href);
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (url.searchParams.get(key) === value) continue;
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    changed = true;
  }
  if (!changed) return;

  const destination = `${url.pathname}${url.search}${url.hash}`;
  if (history === 'replace') window.history.replaceState(window.history.state, '', destination);
  else window.history.pushState(window.history.state, '', destination);
  // pushState/replaceState do not emit popstate. Notify every filter immediately.
  window.dispatchEvent(new Event(URL_STATE_EVENT));
}

function updateUrlParam<T>(key: string, codec: UrlCodec<T>, value: SetStateAction<T>, history: HistoryMode): void {
  const previous = codec.parse(new URLSearchParams(window.location.search).get(key));
  const next = typeof value === 'function' ? (value as (previous: T) => T)(previous) : value;
  updateUrlParams({ [key]: codec.format(next) }, history);
}

/** Normalize a loaded selection without adding a browser history entry. */
export function replaceUrlParam<T>(key: string, codec: UrlCodec<T>, value: SetStateAction<T>): void {
  updateUrlParam(key, codec, value, 'replace');
}

/** Keep codecs stable (for example, declare them outside the component). */
export function useUrlState<T>(
  key: string,
  codec: UrlCodec<T>,
  options?: { history?: HistoryMode },
): [T, Dispatch<SetStateAction<T>>] {
  const search = useSyncExternalStore(subscribe, getSearch, getServerSearch);
  const rawValue = new URLSearchParams(search).get(key);
  const value = useMemo(() => codec.parse(rawValue), [codec, rawValue]);
  const history = options?.history ?? 'push';
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    next => updateUrlParam(key, codec, next, history),
    [key, codec, history],
  );
  return [value, setValue];
}

export function stringParam(defaultValue = ''): UrlCodec<string> {
  return {
    parse: value => value ?? defaultValue,
    format: value => value === defaultValue ? null : value,
  };
}

export function enumParam<const T extends string>(values: readonly T[], defaultValue: T): UrlCodec<T> {
  return {
    parse: value => value !== null && values.includes(value as T) ? value as T : defaultValue,
    format: value => value === defaultValue ? null : value,
  };
}

export function positiveIntParam(defaultValue: number | null = null): UrlCodec<number | null> {
  return {
    parse: value => {
      if (value === null || !/^[1-9]\d*$/.test(value)) return defaultValue;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : defaultValue;
    },
    format: value => value === null || value === defaultValue || !Number.isSafeInteger(value) || value <= 0
      ? null
      : String(value),
  };
}
