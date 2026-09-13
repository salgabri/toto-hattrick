import { Retro2000s } from './aggregate/retro/Retro2000s.js';
import { useEffect, useState } from 'react';
import { snapshot, type DataManifest, type SnapshotError } from './aggregate/snapshot.js';

/**
 * Toto Hattrick — aggregate records over the Hattrick world (trophy leaders, league + cup winners).
 *
 * Rendered in the "2000s" retro look (Toto Hattrick 2000s.dc.html): a Windows-98 skin over the
 * real baked data. The single-team season archive is out of scope; aggregate records are the
 * app's direction.
 */

export function App() {
  const [manifest, setManifest] = useState<DataManifest | null>(null);
  const [error, setError] = useState<SnapshotError | null>(null);
  useEffect(() => {
    const unsubscribe = snapshot.subscribe(setError);
    void snapshot.manifest().then(setManifest).catch(() => { /* subscription displays the failure */ });
    return unsubscribe;
  }, []);
  if (error) return <main role="alert" style={{ margin: '3rem auto', maxWidth: 600, padding: 24 }}>
    <p>{error.message}</p><button onClick={() => window.location.reload()}>Reload archive</button>
  </main>;
  return <>
    <Retro2000s />
    {manifest && <details style={{ margin: '8px auto', maxWidth: 1200, padding: '0 16px', fontSize: 12 }}>
      <summary>Archive source checks</summary>
      {manifest.sources.length === 0 ? <p>No source check dates recorded yet.</p> : <ul>{manifest.sources.map((source) => <li key={source.key}>
        {source.label}: {source.lastSuccessfulCheck ? `last checked ${new Date(source.lastSuccessfulCheck).toLocaleDateString()}` : 'awaiting a source check'}
        {source.status === 'failed' ? ' · latest check unsuccessful' : ''}
        {source.pending > 0 ? ` · ${source.pending} pending` : ''}
      </li>)}</ul>}
    </details>}
  </>;
}
