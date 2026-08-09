/**
 * Time-zone validation shared by the API DTO, the web profile panel, and the
 * mobile preferences screen.
 *
 * Centralizing the rule prevents the layers from drifting apart: a client that
 * accepts what the server rejects produces a save that fails with no
 * field-level explanation, which is exactly how an unresolvable
 * `quiet_hours_tz` reached stored rows in the first place (#687).
 *
 * The rule enforced here is exactly **"a zone this runtime can resolve"** — the
 * property delivery actually depends on, since `Intl.DateTimeFormat` throwing is
 * what breaks it.
 *
 * It is deliberately *not* "must be a DST-aware IANA name". Requiring an IANA
 * name would not buy that anyway: `UTC`, `EST`, and `Etc/GMT+5` are all real
 * IANA identifiers that never observe DST. Narrowing to zones that do follow DST
 * would also start rejecting values already sitting in stored rows, which is the
 * lockout this module exists to prevent. Tightening that further needs a
 * backfill and a zone picker; it is tracked separately.
 *
 * **Fixed offsets (`-05:00`) are not portable and must not be relied on.**
 * Whether `Intl` resolves them depends on the runtime's ICU: Node 20 — what the
 * Dockerfile and CI run — rejects them; Node 22 accepts them. The old web panel
 * labelled this field "Timezone offset", so stored rows can hold one; on the
 * deployment runtime those are simply unresolvable, which the delivery guard
 * handles by degrading to UTC. Steer people to named zones.
 */

/** Longest value the `user_settings.quiet_hours_tz` column is allowed to carry. */
export const MAX_TIME_ZONE_LENGTH = 100;

/**
 * Whether the runtime can resolve named zones at all. Fixed for the life of the
 * process, so it is probed once rather than on every validation — and when it is
 * false we fail **open**, so a stripped-down ICU build (a lean container, an
 * older React Native JSC) rejects nothing rather than everything.
 */
const RUNTIME_RESOLVES_ZONES = (() => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: "UTC" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * True when `tz` is a zone this system will accept and store — i.e. one the
 * runtime can format with, which is precisely what notification delivery needs.
 */
export function isSupportedTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;

  const value = tz.trim();
  if (value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) return false;

  if (!RUNTIME_RESOLVES_ZONES) return true;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes a timezone field coming off a form or an API payload.
 *
 * Returns `null` for "the member cleared this", which is distinct from "the
 * member typed something invalid" (`undefined`). A blank input is a clear, not a
 * validation error — the web panel binds the field to `""`, so treating blank as
 * invalid would leave a member unable to turn quiet hours off.
 */
export function normalizeTimeZoneInput(
  value: unknown,
): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return isSupportedTimeZone(trimmed) ? trimmed : undefined;
}
