/**
 * Theming for the "Toto Hattrick 2000s" retro look — the Windows-98/early-web skin from
 * `Toto Hattrick 2000s.dc.html`. Two skins (bottle-green, steel-blue) and a density switch,
 * flowed through CSS custom properties on the root wrapper. Inline styles read them via
 * `var(--x, fallback)`, exactly like the modern look's `theme.ts`.
 *
 * System fonts only (Verdana / Tahoma / MS Sans Serif) — no web fonts, so the retro look stays
 * self-contained just like the flags. Monospace figures use 'Courier New' for the LCD feel.
 */
import type { CSSProperties } from 'react';

export type Skin = 'green' | 'blue';
export type Density2000s = 'comfortable' | 'compact';

export const SKINS: Record<Skin, Record<string, string>> = {
  green: {
    '--desk': '#C6CDBF', '--frame': '#617D54', '--framelt': '#9DB491',
    '--bar1': '#729A5F', '--bar2': '#4E7642', '--barink': '#FFFFFF',
    '--mod': '#567E47', '--mod2': '#6F975C', '--modink': '#FFFFFF',
    '--panel': '#FFFFFF', '--panel2': '#F2F5ED', '--alt': '#F1F5EB',
    '--line': '#CDD7C3', '--ink': '#27321F', '--soft': '#5E7150', '--faint': '#8B9C7E',
    '--link': '#1A4EA8', '--champ': '#427E37', '--main': '#B07E2A', '--sec': '#BAC3AF',
    '--btn': '#EBEFE2', '--btn2': '#D4DEC9', '--hover': '#FBF5DB', '--selrow': '#F7F0D9',
  },
  blue: {
    '--desk': '#C6CCD9', '--frame': '#516A9C', '--framelt': '#9AADD1',
    '--bar1': '#6083C3', '--bar2': '#3E5C96', '--barink': '#FFFFFF',
    '--mod': '#456599', '--mod2': '#6083C3', '--modink': '#FFFFFF',
    '--panel': '#FFFFFF', '--panel2': '#F1F4FA', '--alt': '#F0F3F9',
    '--line': '#CAD4E6', '--ink': '#212A3C', '--soft': '#576480', '--faint': '#8492AA',
    '--link': '#1A46A0', '--champ': '#3E5AA2', '--main': '#BC882C', '--sec': '#B6BFCF',
    '--btn': '#EBEFF7', '--btn2': '#D4DFEF', '--hover': '#FBF5DB', '--selrow': '#F7F0D9',
  },
};

export const DENS2000s: Record<Density2000s, Record<string, string>> = {
  comfortable: { '--rp': '7px' },
  compact: { '--rp': '3px' },
};

/** Root style: skin + density CSS vars, plus the desktop backdrop the framed window sits on. */
export function rootStyle2000s(skin: Skin, density: Density2000s): CSSProperties {
  const vars: Record<string, string> = {
    ...SKINS[skin],
    ...DENS2000s[density],
    minHeight: '100vh',
    background: 'var(--desk,#C6CDBF)',
    padding: '18px 14px',
    fontFamily: "Verdana,Tahoma,'MS Sans Serif',Geneva,sans-serif",
  };
  return vars as CSSProperties;
}

/** Shared color tokens (mirrors the prototype's inline `var()` refs, green-skin fallbacks). */
export const R = {
  desk: 'var(--desk,#C6CDBF)',
  frame: 'var(--frame,#617D54)',
  framelt: 'var(--framelt,#9DB491)',
  bar1: 'var(--bar1,#729A5F)',
  bar2: 'var(--bar2,#4E7642)',
  barink: 'var(--barink,#FFFFFF)',
  mod: 'var(--mod,#567E47)',
  mod2: 'var(--mod2,#6F975C)',
  modink: 'var(--modink,#FFFFFF)',
  panel: 'var(--panel,#FFFFFF)',
  panel2: 'var(--panel2,#F2F5ED)',
  alt: 'var(--alt,#F1F5EB)',
  line: 'var(--line,#CDD7C3)',
  ink: 'var(--ink,#27321F)',
  soft: 'var(--soft,#5E7150)',
  faint: 'var(--faint,#8B9C7E)',
  champ: 'var(--champ,#427E37)',
  main: 'var(--main,#B07E2A)',
  sec: 'var(--sec,#BAC3AF)',
  masters: 'var(--masters,#7A5EA6)', // Hattrick Masters — regal violet, its own category
  btn: 'var(--btn,#EBEFE2)',
  btn2: 'var(--btn2,#D4DEC9)',
  hover: 'var(--hover,#FBF5DB)',
  selrow: 'var(--selrow,#F7F0D9)',
} as const;

export const MONO = "'Courier New',monospace";
