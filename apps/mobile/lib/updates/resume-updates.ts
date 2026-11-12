/**
 * When an over-the-air update reaches the member (docs/ops/deployment/mobile.md
 * § 6.7, "On the phone").
 *
 * `app.json` sets `checkAutomatically: ON_LOAD` with `fallbackToCacheTimeout:
 * 0`, so on its own expo-updates downloads an update during one cold launch and
 * runs it on the next. iOS keeps an app suspended for days, so a fix could take
 * that long to reach a member who never swipes the app away.
 *
 * This adds two things, the "install on next resume, after a minimum time in the
 * background" rule CodePush apps use:
 *
 * - **A check on return.** Coming back to the foreground looks for a newer
 *   update and downloads it, at most every {@link CHECK_EVERY_MS}, so a phone
 *   that is never cold-launched still fetches fixes.
 * - **Applying on return after a real absence.** When an update is downloaded
 *   and the member comes back after at least {@link AWAY_BEFORE_APPLY_MS} in
 *   the background, the app reloads into it straight away, before they have
 *   started doing anything. A short trip out (copying a code from Messages,
 *   answering a text) never reloads. Drafts and the outbox are already on disk
 *   (`lib/chat/draft-store.ts`, `lib/chat/outbox-store.ts`), so a reload loses
 *   nothing typed.
 *
 * It never reloads while {@link ResumeUpdatesDeps.busy} says something can't be
 * interrupted (a meeting recording running in the background), and never in
 * development, Expo Go or an emergency launch, where expo-updates is off or the
 * last update already failed to start.
 *
 * Pure apart from the injected ports, so the rule is tested without a phone
 * (`resume-updates.spec.ts`); `use-resume-updates.ts` binds it to expo-updates
 * and `AppState`.
 */

/** How long the app must sit in the background before a return reloads it. */
export const AWAY_BEFORE_APPLY_MS = 10 * 60_000;

/** The least time between two checks a return to the foreground starts. */
export const CHECK_EVERY_MS = 15 * 60_000;

export type ResumeAppState = "active" | "background" | "inactive" | string;

export interface UpdatesPort {
  /**
   * expo-updates is on for this launch: a release build, not Expo Go or
   * development, and not an emergency launch.
   */
  readonly enabled: boolean;
  /** Is a downloaded update waiting to run? Read live, never cached. */
  isUpdatePending(): boolean;
  /** Ask the server for a newer update and download it when there is one. */
  checkAndFetch(): Promise<void>;
  /** Restart the JS into the downloaded update. */
  reload(): Promise<void>;
}

export interface ResumeUpdatesDeps {
  updates: UpdatesPort;
  /** True while a reload would interrupt work the member can't redo. */
  busy: () => boolean;
  now: () => number;
  /** A check or reload failed. Reported, never shown: the next return tries again. */
  report: (error: unknown, step: "check" | "reload") => void;
}

export interface ResumeUpdates {
  onAppStateChange(next: ResumeAppState): void;
}

export function createResumeUpdates(deps: ResumeUpdatesDeps): ResumeUpdates {
  const { updates, busy, now, report } = deps;
  let backgroundSince: number | null = null;
  // The launch itself checked (ON_LOAD), so the first return within the
  // window doesn't ask again.
  let lastCheck = now();
  let checking = false;
  let reloading = false;

  const check = () => {
    if (checking) return;
    checking = true;
    lastCheck = now();
    updates
      .checkAndFetch()
      .catch((error: unknown) => report(error, "check"))
      .finally(() => {
        checking = false;
      });
  };

  return {
    onAppStateChange(next) {
      if (!updates.enabled || reloading) return;
      if (next === "background") {
        backgroundSince ??= now();
        return;
      }
      // `inactive` (iOS: Control Center, a call banner, the app switcher) is
      // neither leaving nor coming back.
      if (next !== "active") return;

      const away = backgroundSince === null ? 0 : now() - backgroundSince;
      backgroundSince = null;

      if (
        away >= AWAY_BEFORE_APPLY_MS &&
        updates.isUpdatePending() &&
        !busy()
      ) {
        reloading = true;
        updates.reload().catch((error: unknown) => {
          reloading = false;
          report(error, "reload");
        });
        return;
      }
      if (now() - lastCheck >= CHECK_EVERY_MS) check();
    },
  };
}
