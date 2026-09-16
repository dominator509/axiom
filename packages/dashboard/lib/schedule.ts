/** Convert the browser's timezone-free datetime-local value to the REST contract. */
export function approvalSlot(value: string, now = Date.now()): string | undefined {
  if (!value) return undefined;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) throw new Error('Choose a valid local date and time.');
  const [, year, month, day, hour, minute] = parts.map(Number);
  const date = new Date(value);
  // Reject calendar rollover and DST gaps instead of silently moving the slot.
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    throw new Error('That date and time does not exist in your local timezone.');
  }
  if (date.getTime() <= now) throw new Error('Choose a future date and time.');
  return date.toISOString();
}
