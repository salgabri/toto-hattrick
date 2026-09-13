import 'dotenv/config';
import { z } from 'zod';

/**
 * Build step 1: validate env up front and fail loudly if anything required is missing.
 * Import `env` from here; never read `process.env` elsewhere.
 */
const EnvSchema = z.object({
  CHPP_CONSUMER_KEY: z.string().min(1, 'CHPP_CONSUMER_KEY is required'),
  CHPP_CONSUMER_SECRET: z.string().min(1, 'CHPP_CONSUMER_SECRET is required'),
  CHPP_CALLBACK_URL: z.string().min(1).default('oob'),
  OAUTH_ACCESS_STASH: z.string().min(1).default('.oauth-access.json'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  UPDATE_STORE_DIR: z.string().min(1).optional(),
  UPDATE_STATE_BUCKET: z.string().min(1).optional(),
  UPDATE_STATE_PREFIX: z.string().default('hattrick-archive'),
  AWS_REGION: z.string().min(1).default('eu-central-1'),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SESSION_TOKEN: z.string().min(1).optional(),
  UPDATE_WORK_DIR: z.string().min(1).default('../.update-work'),
  UPDATE_MAX_CALLS: z.coerce.number().int().min(0).max(10000).default(600),
  UPDATE_MAX_ITEMS: z.coerce.number().int().positive().max(10000).default(300),
  UPDATE_MAX_MINUTES: z.coerce.number().int().min(1).max(90).default(40),
  UPDATE_CHPP_AUTOMATION_APPROVED: z.enum(['true', 'false']).default('false'),
  CHPP_USER_AGENT: z.string().min(1).regex(/^[\x20-\x7e]+$/).default('HattrickArchive/0.1.0'),
  CHPP_ACCESS_TOKEN: z.string().min(1).optional(),
  CHPP_ACCESS_TOKEN_SECRET: z.string().min(1).optional(),
  UPDATE_DEPLOY_PROVIDER: z.enum(['none', 'netlify', 'vercel']).default('none'),
  NETLIFY_SITE_ID: z.string().min(1).optional(),
  NETLIFY_AUTH_TOKEN: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),
  VERCEL_TOKEN: z.string().min(1).optional(),
  VERCEL_PROTECTION_BYPASS: z.string().min(1).optional(),
  UPDATE_PUBLIC_URL: z.string().url().optional(),
  UPDATE_HEARTBEAT_URL: z.string().url().optional(),
  GITHUB_SHA: z.string().optional(),
  GITHUB_STEP_SUMMARY: z.string().optional(),
});

// CI commonly supplies optional secrets as empty strings. Treat those as absent, while the
// required CHPP/DATABASE fields still fail their required checks.
const parsed = EnvSchema.safeParse(Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value])));

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Loud, early exit — every later step depends on these.
  console.error(`\n[env] Invalid or missing environment variables:\n${issues}\n`);
  console.error('Copy .env.example to .env and fill the values.\n');
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

/** Centralize child process configuration; only this module reads environment variables. */
export function childEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides };
}

/** Must be called before importing the shared Prisma client in an isolated update worker. */
export function useUpdateDatabase(databaseUrl: string): void {
  env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;
}
