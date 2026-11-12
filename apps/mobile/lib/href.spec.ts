import { describe, expect, it, vi } from "vitest";
import { goBackTo, isTabHref, openHref } from "./href";

/**
 * A link whose destination is known only at run time (a notification's
 * target) pushes a screen but pops down to a tab, so it never stacks a second
 * tab bar over a pushed screen (`spec/ui/mobile/navigation.md` § Going back).
 */
const router = () => ({
  push: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  dismissTo: vi.fn(),
});
const TABS = ["/", "/activity", "/events", "/you", "/events?focus=1"];

describe("openHref", () => {
  it.each(TABS)("pops down to the tab %s", (href) => {
    const r = router();
    openHref(r, href as never);
    expect(r.dismissTo).toHaveBeenCalledWith(href);
    expect(r.push).not.toHaveBeenCalled();
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it("pushes a screen, in either href form", () => {
    const r = router();
    openHref(r, "/dues" as never);
    openHref(r, { pathname: "/event-details", params: { id: "e1" } } as never);
    expect(r.push).toHaveBeenCalledTimes(2);
    expect(r.dismissTo).not.toHaveBeenCalled();
  });

  it("replaces the screen on top when the link is the same kind of screen", () => {
    // A push for a channel while a channel is open replaces it, so back
    // still reaches chat home rather than a second channel (2026-11-07).
    const r = router();
    openHref(r, "/chat-thread?channelId=c2" as never, "/chat-thread");
    expect(r.replace).toHaveBeenCalledWith("/chat-thread?channelId=c2");
    expect(r.push).not.toHaveBeenCalled();
    openHref(r, "/chat-thread?channelId=c2" as never, "/profile");
    expect(r.push).toHaveBeenCalledTimes(1);
  });

  it("pushes the task board, a screen since it left the tab bar (#4610)", () => {
    const r = router();
    openHref(r, "/tasks?focus=1" as never);
    expect(r.push).toHaveBeenCalledWith("/tasks?focus=1");
    expect(r.dismissTo).not.toHaveBeenCalled();
  });

  it("reads the object form's pathname", () => {
    expect(isTabHref({ pathname: "/activity" } as never)).toBe(true);
    expect(isTabHref({ pathname: "/tasks" } as never)).toBe(false);
    expect(isTabHref({ pathname: "/chat-thread" } as never)).toBe(false);
  });
});

describe("goBackTo", () => {
  it.each(TABS)("pops down to the tab %s", (href) => {
    const r = router();
    goBackTo(r, href as never);
    expect(r.dismissTo).toHaveBeenCalledWith(href);
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it("navigates to a screen that isn't a tab", () => {
    const r = router();
    goBackTo(r, "/profile" as never);
    expect(r.navigate).toHaveBeenCalledWith("/profile");
    expect(r.dismissTo).not.toHaveBeenCalled();
  });
});
