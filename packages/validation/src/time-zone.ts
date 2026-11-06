/**
 * Time-zone validation for the API DTO, and the clients' zone helpers.
 *
 * (2026-11-06) Neither client takes a typed zone any more: mobile s16 and web
 * Profile use the device's or browser's zone, and offer it in place of a
 * different stored one. So `isSupportedTimeZone` now guards only the server,
 * and the form-input normalizer that web's typed field needed is gone.
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
 * True when `tz` is written as a UTC offset rather than as a zone name. The
 * verdict is the same on every runtime, so a client may repair such a value
 * without second-guessing the server (the mobile quiet-hours sync does).
 */
export function isUtcOffset(tz: string): boolean {
  return UTC_OFFSET_PATTERN.test(tz.trim());
}

/**
 * True when `tz` is a zone this system will accept and store: a named zone the
 * runtime can format with, which is precisely what notification delivery needs.
 * Fixed UTC offsets are rejected on every runtime (see the module docblock).
 */
export function isSupportedTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;

  const value = tz.trim();
  if (value.length === 0 || value.length > MAX_TIME_ZONE_LENGTH) return false;

  if (isUtcOffset(value)) return false;

  if (!RUNTIME_RESOLVES_ZONES) return true;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * `America/Los_Angeles` -> "Los Angeles": the part of a zone name a member
 * recognises, for the line that says which zone quiet hours run in (mobile
 * s16 and web Profile). Display only; the stored value is the full name.
 */
export function timeZoneCity(tz: string): string {
  return (tz.split("/").pop() ?? tz).replace(/_/g, " ");
}

/** The zone {@link localTimeZone} answers when the runtime gives no usable one. */
export const FALLBACK_TIME_ZONE = "America/New_York";

/**
 * This device's or browser's zone: what quiet hours default to on mobile s16
 * and web Profile, and the zone both offer in place of a different stored one.
 * Some runtimes report a custom system zone as an offset (`TZ=GMT-5` gives
 * `"-05:00"` on Node 24), and the server rejects offsets on every runtime
 * (#2361), so an offset falls back too rather than seeding a PATCH that 400s.
 */
export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && !isUtcOffset(tz) ? tz : FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}
