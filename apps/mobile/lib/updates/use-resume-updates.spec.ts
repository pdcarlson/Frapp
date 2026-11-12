/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updates: {
    isEnabled: true,
    isEmergencyLaunch: false,
    latestContext: { isUpdatePending: false },
    checkForUpdateAsync: vi.fn(
      async (): Promise<{
        isAvailable: boolean;
        isRollBackToEmbedded: boolean;
      }> => ({
        isAvailable: false,
        isRollBackToEmbedded: false,
      }),
    ),
    fetchUpdateAsync: vi.fn(async () => ({ isNew: true })),
    reloadAsync: vi.fn(async () => {}),
  },
  listener: null as ((next: string) => void) | null,
  urlListener: null as (() => void) | null,
  tapListener: null as (() => void) | null,
  online: true,
  captureException: vi.fn(),
  busy: false,
}));

vi.mock("expo-updates", () => state.updates);
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, listener: (next: string) => void) => {
      state.listener = listener;
      return { remove: () => (state.listener = null) };
    },
  },
  Linking: {
    addEventListener: (_: string, listener: () => void) => {
      state.urlListener = listener;
      return { remove: () => (state.urlListener = null) };
    },
  },
}));
vi.mock("@/lib/notifications/push", () => ({
  addNotificationResponseListener: (listener: () => void) => {
    state.tapListener = listener;
    return { remove: () => (state.tapListener = null) };
  },
}));
vi.mock("@sentry/react-native", () => ({
  captureException: state.captureException,
}));
vi.mock("@tanstack/react-query", () => ({
  onlineManager: { isOnline: () => state.online },
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  isMeetingRecorderBusy: () => state.busy,
}));

const { expoUpdatesPort, useResumeUpdates } =
  await import("./use-resume-updates");
const { AWAY_BEFORE_APPLY_MS, CHECK_EVERY_MS, RELOAD_SETTLE_MS } =
  await import("./resume-updates");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  state.updates.isEmergencyLaunch = false;
  state.updates.isEnabled = true;
  state.busy = false;
  state.updates.latestContext = { isUpdatePending: false };
  state.online = true;
});

describe("expoUpdatesPort", () => {
  it("downloads only when the server has a newer update", async () => {
    await expoUpdatesPort().checkAndFetch();
    expect(state.updates.fetchUpdateAsync).not.toHaveBeenCalled();
    state.updates.checkForUpdateAsync.mockResolvedValueOnce({
      isAvailable: true,
      isRollBackToEmbedded: false,
    });
    await expoUpdatesPort().checkAndFetch();
    expect(state.updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it("fetches a roll-back-to-store-build directive too, so a rollback reaches the phone", async () => {
    state.updates.checkForUpdateAsync.mockResolvedValueOnce({
      isAvailable: false,
      isRollBackToEmbedded: true,
    });
    await expoUpdatesPort().checkAndFetch();
    expect(state.updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it("is off on an emergency launch, so a failed update is never reloaded into", () => {
    state.updates.isEmergencyLaunch = true;
    expect(expoUpdatesPort().enabled).toBe(false);
  });

  it("reloads behind the splash's own colour, with no spinner", async () => {
    await expoUpdatesPort().reload();
    expect(state.updates.reloadAsync).toHaveBeenCalledWith({
      reloadScreenOptions: expect.objectContaining({
        backgroundColor: "#0A0A0A",
        spinner: { enabled: false },
      }),
    });
  });
});

describe("useResumeUpdates", () => {
  it("reloads when the member comes back after ten minutes with an update downloaded", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    renderHook(() => useResumeUpdates());
    state.updates.latestContext = { isUpdatePending: true };
    state.listener?.("background");
    vi.advanceTimersByTime(AWAY_BEFORE_APPLY_MS);
    state.listener?.("active");
    vi.advanceTimersByTime(RELOAD_SETTLE_MS);
    expect(state.updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it("never reloads while a meeting is being recorded", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    state.busy = true;
    renderHook(() => useResumeUpdates());
    state.updates.latestContext = { isUpdatePending: true };
    state.listener?.("background");
    vi.advanceTimersByTime(AWAY_BEFORE_APPLY_MS);
    state.listener?.("active");
    vi.advanceTimersByTime(RELOAD_SETTLE_MS);
    expect(state.updates.reloadAsync).not.toHaveBeenCalled();
  });

  it("leaves a return through a link or a notification tap where it was going", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    renderHook(() => useResumeUpdates());
    state.updates.latestContext = { isUpdatePending: true };
    for (const arrive of [
      () => state.urlListener?.(),
      () => state.tapListener?.(),
    ]) {
      state.listener?.("background");
      vi.advanceTimersByTime(AWAY_BEFORE_APPLY_MS);
      state.listener?.("active");
      arrive();
      vi.advanceTimersByTime(RELOAD_SETTLE_MS);
    }
    expect(state.updates.reloadAsync).not.toHaveBeenCalled();
  });

  it("does nothing where expo-updates is off (development, Expo Go)", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    state.updates.isEnabled = false;
    renderHook(() => useResumeUpdates());
    state.updates.latestContext = { isUpdatePending: true };
    state.listener?.("background");
    vi.advanceTimersByTime(CHECK_EVERY_MS + AWAY_BEFORE_APPLY_MS);
    state.listener?.("active");
    vi.advanceTimersByTime(RELOAD_SETTLE_MS);
    expect(state.updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(state.updates.reloadAsync).not.toHaveBeenCalled();
  });

  it("reports a check that failed while online", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    state.updates.checkForUpdateAsync.mockRejectedValueOnce(
      new Error("bad url"),
    );
    renderHook(() => useResumeUpdates());
    state.listener?.("background");
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    state.listener?.("active");
    await vi.waitFor(() =>
      expect(state.captureException).toHaveBeenCalledWith(expect.any(Error), {
        level: "warning",
        fingerprint: ["expo-updates", "check"],
        tags: { "expo.updates.step": "check" },
      }),
    );
  });

  it("does not report a check that failed while the phone was offline", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    state.online = false;
    state.updates.checkForUpdateAsync.mockRejectedValueOnce(
      new Error("network"),
    );
    renderHook(() => useResumeUpdates());
    state.listener?.("background");
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    state.listener?.("active");
    await vi.waitFor(() =>
      expect(state.updates.checkForUpdateAsync).toHaveBeenCalled(),
    );
    await Promise.resolve();
    expect(state.captureException).not.toHaveBeenCalled();
  });

  it("reports a failed reload to Sentry as a warning", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    state.updates.reloadAsync.mockRejectedValueOnce(new Error("no runtime"));
    renderHook(() => useResumeUpdates());
    state.updates.latestContext = { isUpdatePending: true };
    state.listener?.("background");
    vi.advanceTimersByTime(AWAY_BEFORE_APPLY_MS);
    state.listener?.("active");
    vi.advanceTimersByTime(RELOAD_SETTLE_MS);
    await vi.waitFor(() =>
      expect(state.captureException).toHaveBeenCalledWith(expect.any(Error), {
        level: "warning",
        fingerprint: ["expo-updates", "reload"],
        tags: { "expo.updates.step": "reload" },
      }),
    );
  });
});
