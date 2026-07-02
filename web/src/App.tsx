import { useEffect, useState } from 'react';
import { AggregateStats } from './aggregate/AggregateStats.js';
import { Retro2000s } from './aggregate/retro/Retro2000s.js';

/**
 * Toto Hattrick — aggregate records over the Hattrick world (trophy leaders, league + cup winners).
 *
 * Two looks over the same real baked data, switchable and remembered across visits:
 *   - modern — the "heritage archive" paper/floodlit design.
 *   - retro  — the "2000s" Windows-98 skin (Toto Hattrick 2000s.dc.html).
 * The single-team season archive is out of scope; aggregate records are the app's direction.
 */

type Look = 'modern' | 'retro';
const LOOK_KEY = 'th.look';

export function App() {
  const [look, setLook] = useState<Look>(() => {
    // Default to the retro "2000s" look (the primary handoff design); a saved preference still
    // wins either way. Storage can throw synchronously (private mode, sandboxed iframe, blocked
    // cookies) — never let a preference read crash the app.
    try {
      return localStorage.getItem(LOOK_KEY) === 'modern' ? 'modern' : 'retro';
    } catch {
      return 'retro';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOOK_KEY, look);
    } catch {
      /* storage unavailable — the look just won't persist across visits. */
    }
  }, [look]);

  return look === 'retro' ? (
    <Retro2000s onExit={() => setLook('modern')} />
  ) : (
    <AggregateStats onRetro={() => setLook('retro')} />
  );
}
