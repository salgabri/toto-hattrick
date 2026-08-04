/**
 * Language state for the whole app: a provider, a `useT()` hook, and `t(key, vars)`.
 *
 * Deliberately hand-rolled rather than an i18n library — the app ships a single bundle of ~200
 * flat keys with no plurals beyond one/many and no date/number formatting to speak of, so a
 * dependency would cost more than it saves.
 *
 * Resolution order for the initial language: a previous explicit choice (localStorage) → the
 * browser's preferred languages → English.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DICTIONARIES, LANGS, type Lang, type TranslationKey } from './translations.js';

export type { Lang, TranslationKey };
export { LANGS };

const STORAGE_KEY = 'th.lang';

const isLang = (v: string | null | undefined): v is Lang => !!v && LANGS.some((l) => l.code === v);

/** Stored choice first, then the browser's list ("de-AT" matches "de"), then English. */
export function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    // Private mode / blocked storage — fall through to the browser preference.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

export type TVars = Record<string, string | number>;

/** Substitutes `{name}` placeholders. Unknown placeholders are left in place, so a bad key in a
 *  translation shows up as literal `{...}` rather than silently swallowing text. */
function interpolate(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? String(vars[k]) : whole));
}

export type TFn = (key: TranslationKey, vars?: TVars) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, []);

  // Keep the document in step, so screen readers and the browser's own translate prompt agree
  // with what's on screen.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback<TFn>(
    (key, vars) => interpolate(DICTIONARIES[lang][key] ?? DICTIONARIES.en[key] ?? key, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** The common case — just the translate function. */
export function useT(): TFn {
  return useI18n().t;
}
