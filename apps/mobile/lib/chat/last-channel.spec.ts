import { beforeEach, describe, expect, it, vi } from "vitest";

const pushState = vi.hoisted(() => ({ tapPending: false }));
vi.mock("@/lib/notifications/push", () => ({
  hasLaunchNotificationTap: () => pushState.tapPending,
}));

const { claimChatLaunch, resetChatLaunchForTests, settleChatLaunch } =
  await import("./last-channel");

describe("claimChatLaunch", () => {
  beforeEach(() => {
    pushState.tapPending = false;
    resetChatLaunchForTests(1_000);
  });

  it("claims the jump once, inside the launch window", () => {
    expect(claimChatLaunch(2_000)).toBe(true);
    expect(claimChatLaunch(2_001)).toBe(false);
  });

  it("stands aside for a tap that launched the app and is not taken yet", () => {
    pushState.tapPending = true;
    expect(claimChatLaunch(2_000)).toBe(false);
    pushState.tapPending = false;
    expect(claimChatLaunch(2_001)).toBe(false);
  });

  it("never jumps once the launch window has passed", () => {
    expect(claimChatLaunch(1_000 + 10_001)).toBe(false);
  });

  it("never jumps after something else settled the launch", () => {
    settleChatLaunch();
    expect(claimChatLaunch(2_000)).toBe(false);
  });
});
