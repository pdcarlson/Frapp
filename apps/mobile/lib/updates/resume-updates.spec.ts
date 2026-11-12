import { describe, expect, it, vi } from "vitest";
import {
  AWAY_BEFORE_APPLY_MS,
  CHECK_EVERY_MS,
  createResumeUpdates,
  type UpdatesPort,
} from "./resume-updates";

function setup(over: Partial<UpdatesPort> & { busy?: boolean } = {}) {
  let clock = 1_000_000;
  let pending = false;
  const updates = {
    enabled: over.enabled ?? true,
    isUpdatePending: vi.fn(() => pending),
    checkAndFetch: over.checkAndFetch ?? vi.fn(async () => {}),
    reload: over.reload ?? vi.fn(async () => {}),
  } satisfies UpdatesPort;
  const report = vi.fn();
  const resume = createResumeUpdates({
    updates,
    busy: () => over.busy ?? false,
    now: () => clock,
    report,
  });
  return {
    resume,
    updates,
    report,
    advance: (ms: number) => {
      clock += ms;
    },
    setPending: (value: boolean) => {
      pending = value;
    },
    /** Leave for `ms`, then come back. */
    awayFor(ms: number) {
      resume.onAppStateChange("background");
      clock += ms;
      resume.onAppStateChange("active");
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createResumeUpdates", () => {
  it("reloads into a downloaded update when the member returns after ten minutes away", () => {
    const t = setup();
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS);
    expect(t.updates.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads after a short trip out", () => {
    const t = setup();
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS - 1);
    expect(t.updates.reload).not.toHaveBeenCalled();
  });

  it("counts the time away from when the app went to the background, not from a later background event", () => {
    const t = setup();
    t.setPending(true);
    t.resume.onAppStateChange("background");
    t.advance(AWAY_BEFORE_APPLY_MS / 2);
    t.resume.onAppStateChange("background");
    t.advance(AWAY_BEFORE_APPLY_MS / 2);
    t.resume.onAppStateChange("active");
    expect(t.updates.reload).toHaveBeenCalledTimes(1);
  });

  it("treats inactive (Control Center, the app switcher) as neither leaving nor returning", () => {
    const t = setup();
    t.setPending(true);
    t.resume.onAppStateChange("inactive");
    t.advance(AWAY_BEFORE_APPLY_MS);
    t.resume.onAppStateChange("active");
    expect(t.updates.reload).not.toHaveBeenCalled();
  });

  it("never reloads while a meeting is being recorded", () => {
    const t = setup({ busy: true });
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS * 3);
    expect(t.updates.reload).not.toHaveBeenCalled();
  });

  it("does nothing at all where expo-updates is off (development, Expo Go, an emergency launch)", () => {
    const t = setup({ enabled: false });
    t.setPending(true);
    t.awayFor(CHECK_EVERY_MS + AWAY_BEFORE_APPLY_MS);
    expect(t.updates.reload).not.toHaveBeenCalled();
    expect(t.updates.checkAndFetch).not.toHaveBeenCalled();
  });

  it("checks for a newer update on return once the last check is fifteen minutes old", () => {
    const t = setup();
    t.awayFor(CHECK_EVERY_MS - 1);
    expect(t.updates.checkAndFetch).not.toHaveBeenCalled();
    t.awayFor(1);
    expect(t.updates.checkAndFetch).toHaveBeenCalledTimes(1);
    t.awayFor(60_000);
    expect(t.updates.checkAndFetch).toHaveBeenCalledTimes(1);
  });

  it("checks rather than reloads when nothing is downloaded yet, so the next long absence can apply it", () => {
    const t = setup();
    t.awayFor(CHECK_EVERY_MS);
    expect(t.updates.reload).not.toHaveBeenCalled();
    expect(t.updates.checkAndFetch).toHaveBeenCalledTimes(1);
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS);
    expect(t.updates.reload).toHaveBeenCalledTimes(1);
  });

  it("runs one check at a time", async () => {
    let finish: () => void = () => {};
    const checkAndFetch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const t = setup({ checkAndFetch });
    t.awayFor(CHECK_EVERY_MS);
    t.awayFor(CHECK_EVERY_MS);
    expect(checkAndFetch).toHaveBeenCalledTimes(1);
    finish();
    await flush();
    t.awayFor(CHECK_EVERY_MS);
    expect(checkAndFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed check and tries again on a later return", async () => {
    const checkAndFetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const t = setup({ checkAndFetch });
    t.awayFor(CHECK_EVERY_MS);
    await flush();
    expect(t.report).toHaveBeenCalledWith(expect.any(Error), "check");
    t.awayFor(CHECK_EVERY_MS);
    expect(checkAndFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a failed reload and can reload on a later return", async () => {
    const reload = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("no runtime"))
      .mockResolvedValue(undefined);
    const t = setup({ reload });
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS);
    await flush();
    expect(t.report).toHaveBeenCalledWith(expect.any(Error), "reload");
    t.awayFor(AWAY_BEFORE_APPLY_MS);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("ignores app state changes once a reload has started", () => {
    const reload = vi.fn(() => new Promise<void>(() => {}));
    const t = setup({ reload });
    t.setPending(true);
    t.awayFor(AWAY_BEFORE_APPLY_MS);
    t.awayFor(AWAY_BEFORE_APPLY_MS + CHECK_EVERY_MS);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(t.updates.checkAndFetch).not.toHaveBeenCalled();
  });
});
