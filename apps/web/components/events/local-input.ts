import { parseInstant } from "@repo/formatting";

/**
 * An instant as a `datetime-local` value in the viewer's zone, or "" when it
 * isn't one. Its own module so a screen that only fills the event editor's
 * opening values doesn't pull the editor itself into its bundle.
 */
export function isoToLocalInput(value: unknown): string {
  const date = parseInstant(value);
  if (!date) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}
