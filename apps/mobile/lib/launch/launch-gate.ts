import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * When the launch logo lifts (#5449, `spec/ui/mobile/navigation.md` § Launch).
 *
 * A cold launch, or the reload that applies an over-the-air update, starts the
 * app's code afresh, and the logo (`components/launch-cover.tsx`) covers the
 * screen from that moment until the screen the member lands on can show its
 * real content, so they never see its skeleton first. A return from the
 * background keeps the same process, so the gate has long since lifted and
 * nothing shows.
 *
 * The ready signal is the one each screen already gives for Sentry's time to
 * full display (`lib/sentry/screen-ready.tsx`): the screen's own "the content
 * is here" condition, reported while it is focused. The gate lifts:
 *
 * - **ready**, once every focused reporter says ready and goes on saying so
 *   for {@link READY_SETTLE_MS}. The wait covers a hand-off: chat home's
 *   launch jump opens the last channel the moment the list answers, and for a
 *   frame the list can read ready while still focused; the channel then
 *   focuses with its own reporter not ready, which cancels the lift;
 * - **drawn**, when the landed screen gives no signal (sign-in, a linked
 *   screen, most notification targets): once the navigator has a screen in
 *   front and no reporter has turned up within {@link NO_REPORTER_GRACE_MS},
 *   the screen is what it is, and it shows its own loading state;
 * - **cap**, {@link LAUNCH_CAP_MS} after the app's code started, whatever is
 *   still loading (Paul, 2026-11-17: offline or bad signal never strands a
 *   member on the logo);
 * - **now**, when something must be seen at once (the update-required prompt).
 *
 * A hold (a notification tap waiting for the session before it opens its
 * screen) keeps it up whatever the screens say, until the cap.
 */
export const LAUNCH_CAP_MS = 4_000;
export const READY_SETTLE_MS = 150;
export const NO_REPORTER_GRACE_MS = 250;

export type LaunchLift = "ready" | "drawn" | "cap" | "now";

type Schedule = (run: () => void, ms: number) => () => void;

export type LaunchGate = {
  /** Why it lifted, or null while it still covers the screen. */
  lifted(): LaunchLift | null;
  subscribe(listener: () => void): () => void;
  /**
   * A focused screen's ready flag; null when it blurs or unmounts. `key` is
   * the reporter's own, so two mounted screens never overwrite each other.
   */
  report(key: object, ready: boolean | null): void;
  /** Whether the navigator has a screen in front yet. */
  setLanded(landed: boolean): void;
  /** Keeps the logo up until the returned release runs (or the cap). */
  hold(): () => void;
  lift(reason: LaunchLift): void;
};

export function createLaunchGate({
  schedule,
  capMs = LAUNCH_CAP_MS,
  settleMs = READY_SETTLE_MS,
  graceMs = NO_REPORTER_GRACE_MS,
}: {
  schedule: Schedule;
  capMs?: number;
  settleMs?: number;
  graceMs?: number;
}): LaunchGate {
  let liftedFor: LaunchLift | null = null;
  const listeners = new Set<() => void>();
  const reporters = new Map<object, boolean>();
  let holds = 0;
  let landed = false;
  let pending: { kind: "ready" | "drawn"; cancel: () => void } | null = null;

  function lift(reason: LaunchLift): void {
    if (liftedFor) return;
    liftedFor = reason;
    pending?.cancel();
    pending = null;
    cancelCap();
    reporters.clear();
    for (const listener of [...listeners]) listener();
  }

  const cancelCap = schedule(() => lift("cap"), capMs);

  function evaluate(): void {
    if (liftedFor) return;
    let wanted: "ready" | "drawn" | null = null;
    if (holds === 0) {
      if (reporters.size > 0) {
        if ([...reporters.values()].every(Boolean)) wanted = "ready";
      } else if (landed) {
        wanted = "drawn";
      }
    }
    // A wait already running for the same reason keeps running, so a screen
    // that re-renders while ready can't postpone the lift for ever.
    if (wanted === pending?.kind) return;
    pending?.cancel();
    pending = null;
    if (!wanted) return;
    const kind = wanted;
    pending = {
      kind,
      cancel: schedule(
        () => lift(kind),
        kind === "ready" ? settleMs : graceMs,
      ),
    };
  }

  return {
    lifted: () => liftedFor,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    report(key, ready) {
      if (liftedFor) return;
      if (ready === null) reporters.delete(key);
      else reporters.set(key, ready);
      evaluate();
    },
    setLanded(next) {
      if (liftedFor || next === landed) return;
      landed = next;
      evaluate();
    },
    hold() {
      if (liftedFor) return () => {};
      holds += 1;
      evaluate();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        evaluate();
      };
    },
    lift,
  };
}

/**
 * The app's one gate, created when this module first loads: the root layout
 * imports it, so that is when the app's code started, and the cap counts
 * from there. Once per process, which is what keeps a return from the
 * background from showing the logo again.
 */
export const launchGate: LaunchGate = createLaunchGate({
  schedule(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
});

/** Why the gate lifted, or null while the logo still covers the screen. */
export function useLaunchLifted(gate: LaunchGate = launchGate): LaunchLift | null {
  return useSyncExternalStore(gate.subscribe, gate.lifted, gate.lifted);
}

/**
 * Reports a screen's ready flag to the gate: `null` while the screen isn't
 * focused. `ScreenReady` calls it, so every screen that times its full display
 * holds the logo the same way.
 */
export function useLaunchReport(
  ready: boolean | null,
  gate: LaunchGate = launchGate,
): void {
  const [key] = useState<object>(() => ({}));
  useEffect(() => {
    gate.report(key, ready);
  }, [gate, key, ready]);
  useEffect(() => () => gate.report(key, null), [gate, key]);
}

/** Keeps the logo up while `active` is true. */
export function useLaunchHold(
  active: boolean,
  gate: LaunchGate = launchGate,
): void {
  useEffect(() => {
    if (!active) return;
    return gate.hold();
  }, [active, gate]);
}
