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
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
});

const parsed = EnvSchema.safeParse(process.env);

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
