import { z } from 'zod';

/**
 * Zod schemas for parsed CHPP XML.
 *
 * ⚠️ INTENTIONALLY UNIMPLEMENTED. The real field names live in the XML samples the user
 * drops into /server/samples (matchesarchive, matchdetails). Do NOT invent shapes here —
 * model these against the actual files, then replace the stubs below.
 *
 * Build order: this is step 4/5 territory. Wire it after OAuth (step 2) succeeds.
 */

class MissingSamplesError extends Error {
  constructor(file: string) {
    super(
      `No zod schema for "${file}" yet. Add the real XML to /server/samples and model the ` +
        `schema against it before parsing. Spec guardrail: never invent field names.`,
    );
    this.name = 'MissingSamplesError';
  }
}

// --- matchesarchive ---------------------------------------------------------
// TODO: define against samples/matchesarchive.xml
export const MatchesArchiveSchema = z.unknown();
export type MatchesArchive = unknown;

export function parseMatchesArchive(_raw: unknown): MatchesArchive {
  throw new MissingSamplesError('matchesarchive');
}

// --- matchdetails -----------------------------------------------------------
// TODO: define against samples/matchdetails.xml
export const MatchDetailsSchema = z.unknown();
export type MatchDetails = unknown;

export function parseMatchDetails(_raw: unknown): MatchDetails {
  throw new MissingSamplesError('matchdetails');
}

// --- teamdetails ------------------------------------------------------------
// TODO: define against samples/teamdetails.xml
export const TeamDetailsSchema = z.unknown();
export type TeamDetails = unknown;

export function parseTeamDetails(_raw: unknown): TeamDetails {
  throw new MissingSamplesError('teamdetails');
}
