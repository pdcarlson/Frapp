import { describe, expect, it, vi } from "vitest";
import { goBackTo, isTabHref, openHref } from "./href";

/**
 * A link whose destination is known only at run time (a notification's
 * target) pushes a screen but pops down to a tab, so it never stacks a second
 * tab bar over a pushed screen (`spec/ui/mobile/navigation.md` § Going back).
 */
const router = () => ({ push: vi.fn(), navigate: vi.fn(), dismissTo: vi.fn() });
const TABS = ["/", "/events", "/tasks", "/more", "/tasks?focus=1"];

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

  it("keeps one channel on the stack, and one copy of any other screen", () => {
    const r = router();
    openHref(r, "/chat-thread?channelId=c1" as never);
    const key = r.push.mock.calls[0]![1].dangerouslySingular as (
      name: string,
      params: Record<string, unknown>,
    ) => string;
    // Any two channels share a key: the push replaces the open one.
    expect(key("chat-thread", { channelId: "c1" })).toBe(
      key("chat-thread", { channelId: "c2" }),
    );
    expect(key("event-details", { id: "e1" })).not.toBe(
      key("event-details", { id: "e2" }),
    );
  });

  it("reads the object form's pathname", () => {
    expect(isTabHref({ pathname: "/tasks" } as never)).toBe(true);
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
