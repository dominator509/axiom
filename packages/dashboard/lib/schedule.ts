/** Convert the browser's timezone-free datetime-local value to the REST contract. */
export function approvalSlot(
  value: string,
  now = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string | undefined {
  if (!value) return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) throw new Error('Choose a valid local date and time.');
  const [, year, month, day, hour, minute] = parts.map(Number);
  const localParts = { year, month, day, hour, minute };
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const matches = (instant: number): boolean => {
    const values = Object.fromEntries(
      formatter.formatToParts(instant)
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    return values.year === localParts.year
      && values.month === localParts.month
      && values.day === localParts.day
      && values.hour === localParts.hour
      && values.minute === localParts.minute;
  };
  // Search the full supported civil-time offset range at minute precision. This
  // detects DST gaps and preserves the earlier instant on repeated local hours.
  const candidates: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 1) {
    const candidate = naiveUtc - offsetMinutes * 60_000;
    if (matches(candidate)) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    throw new Error('That date and time does not exist in your local timezone.');
  }
  const date = new Date(Math.min(...candidates));
  if (date.getTime() <= now) throw new Error('Choose a future date and time.');
  return date.toISOString();
}
