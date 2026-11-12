/**
 * The focus timer on s10: 25 minutes of focus, then a short break, repeated,
 * the Pomodoro rhythm (Paul, 2026-11-12: "a pomodoro feature").
 *
 * **It is a personal pacing aid, not a crediting rule.** The server credits
 * foreground time in the zone (`spec/behavior/study-sessions.md`), and a break
 * taken in the zone with Frapp open is still time there, so the timer never
 * pauses or stops the session and the credited clock above it never changes
 * because of it. It runs on wall-clock time from when it was turned on, so a
 * re-render, a pause or a trip to another app never drifts it.
 *
 * **The break fits the grace window.** Leaving Frapp during a break pauses the
 * session like any other trip out, and a session left paused past its zone's
 * grace window closes (`PAUSED_EXPIRED`). So the break is a minute shorter
 * than the grace window, capped at five minutes: a member who puts the phone
 * down for the whole break and comes back when it ends is always inside the
 * window.
 */

export const FOCUS_MINUTES = 25;
const BREAK_MINUTES_MAX = 5;

/** The break for a zone: five minutes, or a minute under its grace window. */
export function breakMinutesFor(pauseGraceMinutes: number): number {
  return Math.max(1, Math.min(BREAK_MINUTES_MAX, pauseGraceMinutes - 1));
}

export type FocusPhase = "focus" | "break";

export interface FocusTimerReading {
  phase: FocusPhase;
  /** Whole seconds left in this phase, at least 1 while it runs. */
  secondsLeft: number;
  /** 1 for the first focus block and its break, then 2, and so on. */
  round: number;
}

/** Where the timer is at `nowMs`, for a timer turned on at `startedAtMs`. */
export function readFocusTimer(
  startedAtMs: number,
  nowMs: number,
  breakMinutes: number,
): FocusTimerReading {
  const focusS = FOCUS_MINUTES * 60;
  const cycleS = focusS + breakMinutes * 60;
  const elapsedS = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  const intoCycle = elapsedS % cycleS;
  const round = Math.floor(elapsedS / cycleS) + 1;
  return intoCycle < focusS
    ? { phase: "focus", secondsLeft: focusS - intoCycle, round }
    : { phase: "break", secondsLeft: cycleS - intoCycle, round };
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "Focus · 18:42 left" or "Break · 3:10 left". */
export function focusTimerCopy(reading: FocusTimerReading): string {
  const label = reading.phase === "focus" ? "Focus" : "Break";
  return `${label} · ${clock(reading.secondsLeft)} left`;
}

/**
 * The line under a break. The break is shorter than the grace window, so
 * coming back by its end always keeps the session.
 */
export const BREAK_HINT =
  "Step away if you like. Back in Frapp before the break ends keeps your session.";
