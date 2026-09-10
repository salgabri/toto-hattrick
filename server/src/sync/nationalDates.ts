/** Strict calendar parsing for observed national-team pages. Preserve dates as printed in the
 * database, but never let JS roll an invalid date into another coach's tenure. */
export function nationalDateISO(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = value.match(/^(\d{2})([.\/-])(\d{2})\2(\d{4})(?: ([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?)?$/);
  const date = iso ? value : dmy ? `${dmy[4]}-${dmy[3]}-${dmy[1]}` : null;
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

/** Empty/absent fields are partial scrape holes, not errors; supplied dates must be real. */
export function validSuppliedNationalDates(...dates: Array<string | null | undefined>): boolean {
  return dates.every((date) => date === undefined || date === null || date === '' || nationalDateISO(date) !== null);
}
