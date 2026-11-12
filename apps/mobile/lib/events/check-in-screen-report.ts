import { useEffect, useRef, useState } from "react";
import { useReportCheckInScreen, type CheckInScreenCheck } from "@repo/hooks";
import { tryForegroundFix, type ForegroundPermission } from "@/lib/location";

/**
 * The host screen (s22) telling the server where it is while it shows the
 * code (#4532). Members then check in only within 100 yards of this phone.
 *
 * Once when a code is first drawn, then every minute while the screen stays
 * up with a code on it, so a phone carried to another room moves the check
 * with it. Never while no code is drawn: a report marks the code as in use,
 * which makes it required for the event, and a screen that can't get a code
 * (codes not set up here, or failing) must not lock members out of the event
 * card's plain check-in.
 */
export const CHECK_IN_SCREEN_REPORT_MS = 60_000;

/**
 * What the host screen says about the distance check, from the server's
 * answer and why this phone gave no location:
 *
 * - `screen`: members are checked against this phone (or another screen
 *   showing the code).
 * - `off`: no screen could tell where it is, so distance isn't checked.
 *   `permission` when location is off for Frapp (with whether the OS will
 *   still ask), `imprecise` when the phone gave no fix within 100 m.
 * - `none`: nothing to say: the event's drawn zone is the check, check-in
 *   isn't open, or no answer yet.
 */
export type ScreenPresence =
  | { kind: "screen" }
  | { kind: "off"; reason: "permission"; canAskAgain: boolean }
  | { kind: "off"; reason: "imprecise" }
  | { kind: "none" };

export function screenPresenceOf(
  check: CheckInScreenCheck | null,
  permission: ForegroundPermission,
): ScreenPresence {
  if (check === "screen") return { kind: "screen" };
  if (check !== "no_location") return { kind: "none" };
  return permission.granted
    ? { kind: "off", reason: "imprecise" }
    : {
        kind: "off",
        reason: "permission",
        canAskAgain: permission.canAskAgain,
      };
}

/**
 * Report this screen while `active`, and return what to tell the officer.
 * A failed report keeps the last answer and tries again on the next minute.
 */
export function useCheckInScreenReport(
  eventId: string,
  active: boolean,
): ScreenPresence {
  const { mutateAsync } = useReportCheckInScreen();
  // Kept with the event it describes, so a screen moved to another event
  // says nothing until that event's first answer.
  const [answer, setAnswer] = useState<{
    eventId: string;
    presence: ScreenPresence;
  } | null>(null);
  // When this screen last reported for which event, so a code that blinks off
  // and on (a refetch, a refocus) doesn't send an extra report.
  const lastRef = useRef<{ eventId: string; at: number } | null>(null);

  useEffect(() => {
    if (!active || !eventId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const report = async () => {
      const { fix, permission } = await tryForegroundFix("high");
      if (cancelled) return;
      try {
        const check = await mutateAsync(
          fix
            ? {
                eventId,
                lat: fix.lat,
                lng: fix.lng,
                ...(fix.accuracy_meters === undefined
                  ? {}
                  : { accuracy_meters: fix.accuracy_meters }),
              }
            : { eventId },
        );
        lastRef.current = { eventId, at: Date.now() };
        if (!cancelled) {
          setAnswer({ eventId, presence: screenPresenceOf(check, permission) });
        }
      } catch {
        // Kept: the last answer still describes the event, and the next
        // minute asks again.
      }
    };

    const schedule = (delay: number) => {
      timer = setTimeout(async () => {
        await report();
        if (!cancelled) schedule(CHECK_IN_SCREEN_REPORT_MS);
      }, delay);
    };

    const last = lastRef.current;
    const sinceLast =
      last && last.eventId === eventId ? Date.now() - last.at : Infinity;
    schedule(Math.max(0, CHECK_IN_SCREEN_REPORT_MS - sinceLast));

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, eventId, mutateAsync]);

  return answer && answer.eventId === eventId
    ? answer.presence
    : { kind: "none" };
}
