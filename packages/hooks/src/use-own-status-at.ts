import { useEffect, useMemo, useState } from "react";
import {
  nextStatusChangeAt,
  ownStatusAt,
  type MemberStatusSettings,
  type OwnStatus,
} from "./member-status";

/** `setTimeout` takes at most a signed 32-bit delay; past it, it fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The member's own status (#3845) from `source`, expiry applied, re-rendering
 * at the next end time so a DND for 1 hour ends an hour later even if nothing
 * refetches. `null` in, `null` out. Both clients read their status through
 * this; each decides what `source` is while the settings read is pending or
 * has failed.
 */
export function useOwnStatusAt(
  source: MemberStatusSettings | null,
): OwnStatus | null {
  const [now, setNow] = useState(() => Date.now());

  const own = useMemo(
    () => (source === null ? null : ownStatusAt(source, now)),
    [source, now],
  );
  const nextChange = own ? nextStatusChangeAt(own) : null;

  // The delay is measured from the real clock, not from `now`, so an end time
  // that has already passed (a tab woken from sleep, an app resumed) fires at
  // once. `now` is a dependency so a timer cut short by the 32-bit cap re-arms
  // for the rest.
  useEffect(() => {
    if (nextChange === null) return undefined;
    const delay = Math.max(nextChange - Date.now(), 0);
    const capped = delay > MAX_TIMER_MS;
    const timer = setTimeout(
      // Never earlier than the end itself when the timer was not capped: a
      // timer that fired a millisecond early would otherwise leave the status
      // live, with nothing scheduled to end it. A capped one moves the clock
      // only to now, so it can't end a status weeks early.
      () => setNow(capped ? Date.now() : Math.max(Date.now(), nextChange)),
      capped ? MAX_TIMER_MS : delay,
    );
    return () => clearTimeout(timer);
  }, [nextChange, now]);

  return own;
}
