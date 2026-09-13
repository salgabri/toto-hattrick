/** Official Build Output API routing: filesystem hits first, missing data never falls back
 * to HTML. The same rules live in root vercel.json for the existing Git build transition.
 * https://vercel.com/docs/build-output-api/configuration#routes */
export const VERCEL_ROUTES = [
  { src: '^/data/manifest[.]json$', headers: { 'Cache-Control': 'no-cache, max-age=0, must-revalidate' }, continue: true },
  { src: '^/data/versions/.*$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
  { handle: 'filesystem' },
  { src: '^/(?:data|assets|flags)(?:/.*)?$', status: 404, headers: { 'Cache-Control': 'no-store' } },
  { src: '^/.*$', dest: '/index.html' },
] as const;
