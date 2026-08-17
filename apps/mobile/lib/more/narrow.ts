/**
 * Field readers shared by the More-hub selectors.
 *
 * Every endpoint this cluster reads — `/v1/users/me`, `/v1/points/*`,
 * `/v1/service-entries/*`, `/v1/documents/*`, `/v1/notifications`, `/v1/alumni`
 * — is declared in `openapi.json` without a response schema, so
 * `openapi-typescript` infers its body as `never` and the generated client
 * hands back something no property access compiles against. `lib/events/select.ts`
 * hit the same wall for `/v1/events` and narrowed at the boundary; these are the
 * same readers, factored out rather than copied a sixth time.
 *
 * Narrowing rather than casting is not type hygiene. A row missing `id` routes
 * to a detail view that can never load, and a missing timestamp renders
 * "Invalid Date" to a member — so a row that cannot be drawn honestly is
 * dropped here instead of downstream.
 */

import { initialsFor as chatInitialsFor } from "../chat/display-name";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Every record in `data`, or `[]` when it is not a list. */
export function records(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

/** A non-empty string, or `null`. Empty is treated as absent throughout. */
export function str(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

/** A finite number, or `null`. Rejects `NaN`, which arithmetic would spread. */
export function num(row: Record<string, unknown>, key: string): number | null {
  const raw = row[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Avatar initials, delegating to the chat helper rather than defining a second
 * rule.
 *
 * Both draw the same person's avatar in the same app, so a divergence is
 * visible: an earlier version of this module took the first and *last* words
 * and one letter for a single-word name, which rendered "Ada B. Lovelace" as
 * `AL` in the directory and `AB` in chat, and "Prince" as `P` against `PR`.
 * `lib/chat/display-name.ts` documents why its rule differs from web's; there is
 * no third rule to justify.
 *
 * The only thing added here is the `null` tolerance these selectors need:
 * `users.display_name` is `NOT NULL DEFAULT ''`, so absent and empty are the
 * same "no name set" case and both fall back rather than rendering a blank
 * circle.
 */
export function initialsFor(name: string | null): string {
  return chatInitialsFor(name ?? "");
}

/** `"· "`-joined, skipping absent parts so no separator ever dangles. */
export function metaLine(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return kept.length > 0 ? kept.join(" · ") : null;
}
