import { describe, expect, it } from "vitest";
import { calendarAppLinks } from "./use-calendar-feed";

const LINK = {
  url: "https://api.frapp.live/v1/calendar-feed/feed.ics?token=abc_DEF-123",
  webcal_url:
    "webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=abc_DEF-123",
};

describe("calendarAppLinks", () => {
  it("hands Apple Calendar the webcal link as it is", () => {
    expect(calendarAppLinks(LINK).apple).toBe(LINK.webcal_url);
  });

  it("asks Google Calendar to add the webcal link by URL", () => {
    const google = new URL(calendarAppLinks(LINK).google);
    expect(google.origin + google.pathname).toBe(
      "https://calendar.google.com/calendar/r",
    );
    // The token survives the round trip through the query string whole.
    expect(google.searchParams.get("cid")).toBe(LINK.webcal_url);
  });

  it("asks Outlook to subscribe to the https link", () => {
    const outlook = new URL(calendarAppLinks(LINK).outlook);
    expect(outlook.origin + outlook.pathname).toBe(
      "https://outlook.live.com/calendar/0/addfromweb",
    );
    expect(outlook.searchParams.get("url")).toBe(LINK.url);
    expect(outlook.searchParams.get("name")).toBe("Frapp");
  });
});
