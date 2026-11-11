/** @vitest-environment jsdom */
/**
 * `AppRuntime` is the only place mobile binds the chat realtime manager
 * (#3698): every thread's live messages, chat home's live badges and the
 * foreground resume hang off that one call. Nothing else would notice it
 * gone — the binding's own spec calls the hook directly — so this pins it,
 * with every runtime stubbed.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/chat/use-unread-first-paint-runtime", () => ({
  useUnreadFirstPaintRuntime: () => calls.push("unread-first-paint"),
}));
vi.mock("@/lib/chat/use-chat-runtime", () => ({
  useChatRealtimeBinding: () => calls.push("chat"),
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnectionRuntime: () => calls.push("connection"),
}));
vi.mock("@/lib/notifications/use-badge-sync", () => ({
  useBadgeSyncRuntime: () => calls.push("badge"),
}));
vi.mock("@/lib/notifications/use-notification-sync", () => ({
  useNotificationSyncRuntime: () => calls.push("notification-sync"),
}));
vi.mock("@/lib/notifications/use-push-runtime", () => ({
  usePushRuntime: () => calls.push("push"),
}));
vi.mock("@/lib/onboarding/use-onboarding-redirect", () => ({
  useOnboardingRedirect: () => calls.push("onboarding"),
}));

vi.mock("@/lib/presence/chapter-presence", () => ({
  useChapterPresenceRuntime: () => calls.push("presence"),
}));

const { AppRuntime } = await import("./app-runtime");

describe("AppRuntime", () => {
  it("binds the chat realtime manager app-wide (#3698)", () => {
    renderHook(() => AppRuntime());
    expect(calls).toContain("chat");
  });

  it("keeps notifications in step with the member's other devices (#3929)", () => {
    calls.length = 0;
    renderHook(() => AppRuntime());
    expect(calls).toContain("notification-sync");
  });

  it("shows unread marks before the counts request answers (#4006)", () => {
    calls.length = 0;
    renderHook(() => AppRuntime());
    expect(calls).toContain("unread-first-paint");
  });

  it("runs chapter presence app-wide, so the dots mean online (#3917)", () => {
    calls.length = 0;
    renderHook(() => AppRuntime());
    expect(calls).toContain("presence");
  });
});
