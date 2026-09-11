import { describe, expect, it } from "vitest";
import { isFullBleedRoute } from "./full-bleed-routes";

/**
 * A list of one is still worth pinning: the predicate decides whether every
 * other route keeps its inset, so a change that widens the match (a bare
 * `includes`, say) silently strips the padding off half the app.
 */
describe("isFullBleedRoute", () => {
  it("matches the chat route", () => {
    expect(isFullBleedRoute("/chat")).toBe(true);
  });

  it("matches a nested chat route", () => {
    expect(isFullBleedRoute("/chat/chan-1")).toBe(true);
  });

  it("does not match a route that merely starts with the same letters", () => {
    expect(isFullBleedRoute("/chat-admin")).toBe(false);
  });

  it("does not match a route that merely contains it", () => {
    expect(isFullBleedRoute("/settings/chat")).toBe(false);
  });

  it("leaves every other route inset", () => {
    expect(isFullBleedRoute("/events")).toBe(false);
    expect(isFullBleedRoute("/")).toBe(false);
  });

  it("treats an unresolved pathname as an ordinary route", () => {
    // `usePathname()` can be null; defaulting to full-bleed would strip the
    // padding off whatever renders first.
    expect(isFullBleedRoute(null)).toBe(false);
  });
});
