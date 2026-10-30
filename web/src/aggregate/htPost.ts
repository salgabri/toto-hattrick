/**
 * Hattrick forum markup for a table — what gets pasted into a Hattrick forum post or HT-mail.
 *
 * The shape follows the lists the community already posts by hand: a bold header row, one `[tr]`
 * per line, and a manager or club followed by its `[userid=…]` / `[teamid=…]` tag, which Hattrick
 * renders as a link. A name with no resolved id stays plain text; a tag is never guessed.
 */

export interface HtPost {
  markup: string;
  rows: number;
}

const tr = (cells: readonly string[]) => `[tr]${cells.map((cell) => `[td]${cell}[/td]`).join('')}[/tr]`;

export function htTable(header: readonly string[], rows: ReadonlyArray<readonly string[]>): HtPost {
  const lines = [tr(header.map((label) => `[b]${label}[/b]`)), ...rows.map(tr)];
  return { markup: `[table]${lines.join('\n')}[/table]`, rows: rows.length };
}

const isId = (id: number | undefined): id is number => Number.isSafeInteger(id) && id! > 0;

export const htUser = (name: string, userId?: number) => (isId(userId) ? `${name} [userid=${userId}]` : name);
export const htTeam = (name: string, teamId?: number) => (isId(teamId) ? `${name} [teamid=${teamId}]` : name);
