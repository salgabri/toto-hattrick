import { AggregateStats } from './aggregate/AggregateStats.js';

/**
 * Toto Hattrick — aggregate records over the Hattrick world (trophy leaders, league winners).
 * The single-team season archive is out of scope; this is the app's current direction.
 */
export function App() {
  return <AggregateStats />;
}
