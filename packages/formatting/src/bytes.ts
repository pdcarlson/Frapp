/**
 * File-size formatting for upload and attachment surfaces.
 *
 * Binary units with decimal-ish labels (`KB` = 1024 bytes), matching what every
 * OS file browser shows and what `MAX_UPLOAD_LABEL` in `@repo/validation`
 * already claims — `MAX_UPLOAD_BYTES` is `25 * 1024 * 1024` and is labelled
 * "25 MB", so formatting that same number as "26.2 MB" would contradict the copy
 * next to it in the same composer.
 *
 * Not a locale format: these are unit-suffixed numbers, not dates or currency,
 * and `formatLocaleDateTime`'s cluster rules do not apply.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

/**
 * `0` → `"0 B"`, `900` → `"900 B"`, `2048` → `"2 KB"`, `1572864` → `"1.5 MB"`.
 *
 * One decimal place, and only when it says something: a whole number renders
 * whole, so a 2 MB file is "2 MB" rather than "2.0 MB".
 *
 * A negative or non-finite input returns `"—"` rather than throwing or rendering
 * `"NaN B"`. `chat_message_attachments.byte_size` is nullable — the legacy
 * backfill recovers a path and a filename from prose but cannot recover a size —
 * so callers already have an unknown case, and this keeps a bad number landing
 * in the same visual place as a missing one.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";

  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }

  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}
