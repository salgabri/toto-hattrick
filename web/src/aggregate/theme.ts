/**
 * Theming for the Aggregate Stats views. The "heritage football archive" visual system:
 * warm paper vs floodlit (dark), bottle-green + ochre accent. Colors flow through CSS custom
 * properties set on the root wrapper; inline styles read them via `var(--x, fallback)`.
 */
import type { CSSProperties } from 'react';

export type Theme = 'paper' | 'floodlit';
export type Density = 'comfortable' | 'compact';

export const THEMES: Record<Theme, Record<string, string>> = {
  paper: {
    '--paper': '#F4EFE4',
    '--card': '#FCFAF4',
    '--card-2': '#EFE7D6',
    '--line': '#E6DECB',
    '--line-2': '#D8CDB4',
    '--ink': '#1C201B',
    '--ink-soft': '#776F5D',
    '--ink-faint': '#A99E86',
    '--pitch': '#25523C',
    '--win': '#2E7A4F',
    '--draw': '#8A7F55',
    '--loss': '#A83732',
  },
  floodlit: {
    '--paper': '#101109',
    '--card': '#191B12',
    '--card-2': '#23261A',
    '--line': '#2B2F20',
    '--line-2': '#3B4130',
    '--ink': '#F1EEE0',
    '--ink-soft': '#A9A28B',
    '--ink-faint': '#79735E',
    '--pitch': '#1C3A2B',
    '--win': '#46A06C',
    '--draw': '#9C9268',
    '--loss': '#D0615A',
  },
};

export const DENS: Record<Density, Record<string, string>> = {
  comfortable: { '--rp': '12px' },
  compact: { '--rp': '7px' },
};

/** Build the root style: theme + density CSS vars, the chosen accent, min-height. */
export function rootStyle(theme: Theme, density: Density, accent: string): CSSProperties {
  const vars: Record<string, string> = {
    ...THEMES[theme],
    ...DENS[density],
    '--accent': accent,
    minHeight: '100vh',
  };
  return vars as CSSProperties;
}

/** Shared color tokens (the prototype's `C`) — `var()` refs with paper-theme fallbacks. */
export const C = {
  ink: 'var(--ink,#1C201B)',
  soft: 'var(--ink-soft,#776F5D)',
  faint: 'var(--ink-faint,#A99E86)',
  line: 'var(--line,#E6DECB)',
  line2: 'var(--line-2,#D8CDB4)',
  card: 'var(--card,#FCFAF4)',
  card2: 'var(--card-2,#EFE7D6)',
  accent: 'var(--accent,#B0742A)',
  win: 'var(--win,#2E7A4F)',
} as const;

/** Trophy-mix category colors — fixed independent of the accent so the split always reads. */
export const CHAMP_COLOR = '#2A5140'; // Championships — deep pine green
export const MAIN_COLOR = '#B0742A'; // Main cups — ochre
export const MASTERS_COLOR = '#7A5EA6'; // Hattrick Masters — regal violet (the world title)
