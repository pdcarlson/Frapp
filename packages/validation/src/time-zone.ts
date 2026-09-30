/**
 * Time-zone validation shared by the API DTO, the web profile panel, and the
 * mobile preferences screen.
 *
 * Centralizing the rule prevents the layers from drifting apart: a client that
 * accepts what the server rejects produces a save that fails with no
 * field-level explanation, which is exactly how an unresolvable
 * `quiet_hours_tz` reached stored rows in the first place (#687).
 *
 * The rule enforced here is **"a zone this runtime can resolve, written as a
 * zone rather than as a UTC offset"**. Resolvability is the property delivery
 * actually depends on, since `Intl.DateTimeFormat` throwing is what breaks it.
 *
 * It is deliberately *not* "must be a DST-aware IANA name". Requiring an IANA
 * name would not buy that anyway: `UTC`, `EST`, and `Etc/GMT+5` are all real
 * IANA identifiers that never observe DST. Narrowing to zones that do follow DST
 * would also start rejecting values already sitting in stored rows, which is the
 * lockout this module exists to prevent. Tightening that further needs a
 * backfill and a zone picker; it is tracked separately.
 *
 * **Fixed offsets (`-05:00`, `+0530`, `+05`) are rejected by rule, as a format**
 * (#2361). This is the one place the rule does not defer to `Intl`, because
 * `Intl` cannot give a stable answer: whether it resolves an offset is a
 * property of the runtime's ICU. Node 20 rejects them and Node 22+ accepts them,
 * so the Node 20 → 24 move flipped the server's verdict with no code change, and
 * a client on a leaner ICU build would still disagree with it. The check is a
 * plain pattern, so every runtime reaches the same verdict. It runs before the
 * fail-open below, so a runtime that resolves no zones still rejects offsets.
 * An offset is also the form most likely to be a mistake: it observes no DST,
 * so a member who types `-05:00` gets a quiet window an hour out for the ~8
 * months of daylight time, and the web panel once labelled this field
 * "Timezone offset", which primed people to type one.
 *
 * `Etc/GMT+5` stays accepted. It is also DST-free, but it is a zone name, not
 * an offset, and rejecting it would be the DST-aware narrowing ruled out above.
 *
 * This is a write-path rule. A stored offset row still reads, and delivery
 * evaluates it in whatever zone the runtime resolves it to (or degrades to UTC
 * where it cannot). That guard lives in the API's notification service and is
 * separate from this predicate.
 */

/** Longest value the `user_settings.quiet_hours_tz` column is allowed to carry. */
export const MAX_TIME_ZONE_LENGTH = 100;

/**
 * Whether the runtime can resolve named zones at all. Fixed for the life of the
 * process, so it is probed once rather than on every validation — and when it is
 * false we fail **open**, so a stripped-down ICU build (a lean container, an
 * older React Native JSC) accepts every named zone rather than rejecting
 * everything. The offset rule does not depend on this probe.
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
 * A value that opens with a sign and a digit is UTC-offset syntax. That covers
 * every form some runtime resolves today (`-05:00`, `-0500`, `-05`, and the
 * U+2212 minus `−05:00`) and any it might add later (seconds, say). No IANA zone
 * identifier starts with a sign, so this cannot reject a named zone.
 */
const UTC_OFFSET_PATTERN = /^[+\-\u2212]\d/;

/**
 * True when `tz` is a zone this system will accept and store: a named zone the
 * runtime can format with, which is precisely what notification delivery needs.
 * Fixed UTC offsets are rejected on every runtime (see the module docblock).
 */
export function isSupportedTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;

  const value = tz.trim();
  if (value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) return false;

  if (UTC_OFFSET_PATTERN.test(value)) return false;

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
