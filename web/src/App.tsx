import { Retro2000s } from './aggregate/retro/Retro2000s.js';

/**
 * Toto Hattrick — aggregate records over the Hattrick world (trophy leaders, league + cup winners).
 *
 * Rendered in the "2000s" retro look (Toto Hattrick 2000s.dc.html): a Windows-98 skin over the
 * real baked data. The single-team season archive is out of scope; aggregate records are the
 * app's direction.
 */

export function App() {
  return <Retro2000s />;
}
