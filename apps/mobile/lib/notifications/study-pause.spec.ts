import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
  present: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("./push", () => ({
  presentLocalNotification: push.present,
  clearLocalNotification: push.clear,
}));

import {
  clearStudyPausedNotification,
  notifyStudyPaused,
  resetStudyPauseNotificationForTests,
} from "./study-pause";

describe("study pause notification (#1065)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudyPauseNotificationForTests();
    push.present.mockResolvedValue("local-1");
    push.clear.mockResolvedValue(undefined);
  });

  it("posts the copy the behavior spec specifies, verbatim", async () => {
    await notifyStudyPaused();
    expect(push.present).toHaveBeenCalledWith({
      title: "Study session paused",
      body: "Your study session is paused. Return to Frapp to resume.",
    });
  });

  it("clears on resume", async () => {
    await notifyStudyPaused();
    await clearStudyPausedNotification();
    expect(push.clear).toHaveBeenCalledWith("local-1");
  });

  it("does not stack when a second pause arrives without a resume", async () => {
    await notifyStudyPaused();
    push.present.mockResolvedValue("local-2");
    await notifyStudyPaused();
    // The first notice is withdrawn rather than left beside the second.
    expect(push.clear).toHaveBeenCalledWith("local-1");
  });

  it("has nothing to clear when nothing was posted", async () => {
    await clearStudyPausedNotification();
    expect(push.clear).not.toHaveBeenCalled();
  });

  it("forgets a notice it failed to post, so a later clear is not a lie", async () => {
    push.present.mockRejectedValue(new Error("no module"));
    await expect(notifyStudyPaused()).resolves.toBeUndefined();
    await clearStudyPausedNotification();
    expect(push.clear).not.toHaveBeenCalled();
  });

  it("swallows a failed clear — a stale notice must not break the resume", async () => {
    await notifyStudyPaused();
    push.clear.mockRejectedValue(new Error("gone"));
    await expect(clearStudyPausedNotification()).resolves.toBeUndefined();
  });
});

describe("the same-tick clear (the #1065 orphan)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStudyPauseNotificationForTests();
    push.clear.mockResolvedValue(undefined);
  });

  it("withdraws a notice that was superseded while it was still posting", async () => {
    // `study.tsx` fires `void notifyStudyPaused()` and then applies the pause
    // response synchronously, so a `/pause` that returns terminal clears in the
    // very same tick — before the post has resolved and produced an id. Without
    // the generation counter that clear is a no-op and the member is left with
    // "Return to Frapp to resume" for a session that already ended.
    let resolvePost: (id: string) => void = () => {};
    push.present.mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePost = resolve;
      }),
    );

    const posting = notifyStudyPaused();
    // The clear lands in the same tick, exactly as `study.tsx` issues it.
    const clearing = clearStudyPausedNotification();
    resolvePost("local-9");
    await Promise.all([posting, clearing]);

    // The invariant is "nothing is left standing", and there are two honest
    // ways to satisfy it. Assert the invariant, not one particular route to it.
    if (push.present.mock.calls.length > 0) {
      expect(push.clear).toHaveBeenCalledWith("local-9");
    }
  });

  it("posts nothing at all when the clear beats the post to the OS", async () => {
    let resolvePost: (id: string) => void = () => {};
    push.present.mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePost = resolve;
      }),
    );

    const posting = notifyStudyPaused();
    const clearing = clearStudyPausedNotification();
    resolvePost("local-9");
    await Promise.all([posting, clearing]);

    // `notifyStudyPaused` claims its generation **synchronously** and re-checks
    // it after the withdraw, so a same-tick clear stops it before `present` is
    // ever reached. An earlier fix claimed the generation after that await and
    // still orphaned the notice — this is what pins the difference.
    expect(push.present).not.toHaveBeenCalled();
  });
});
