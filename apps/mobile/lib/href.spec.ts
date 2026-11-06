import { describe, expect, it, vi } from "vitest";
import { isTabHref, openHref } from "./href";

/**
 * A link whose destination is known only at run time (a notification's
 * target) pushes a screen but navigates to a tab, so it never stacks a
 * second tab bar over a pushed screen (`spec/ui/mobile/navigation.md`
 * § Going back).
 */
describe("openHref", () => {
  const router = () => ({ push: vi.fn(), navigate: vi.fn() });

  it.each(["/", "/events", "/tasks", "/more", "/tasks?focus=1"])(
    "navigates to the tab %s",
    (href) => {
      const r = router();
      openHref(r, href as never);
      expect(r.navigate).toHaveBeenCalledWith(href);
      expect(r.push).not.toHaveBeenCalled();
    },
  );

  it("pushes a screen, in either href form", () => {
    const r = router();
    openHref(r, "/dues" as never);
    openHref(r, { pathname: "/event-details", params: { id: "e1" } } as never);
    expect(r.push).toHaveBeenCalledTimes(2);
    expect(r.navigate).not.toHaveBeenCalled();
  });

  it("reads the object form's pathname", () => {
    expect(isTabHref({ pathname: "/tasks" } as never)).toBe(true);
    expect(isTabHref({ pathname: "/chat-thread" } as never)).toBe(false);
  });
});
