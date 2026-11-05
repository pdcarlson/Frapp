import { describe, expect, it } from "vitest";
import { formatDay, formatDayTime } from "@repo/formatting";
import { pollMetaLine } from "./poll-status";

const NOW = new Date("2026-11-05T12:00:00Z");
const EXPIRES = "2026-11-08T09:30:00Z";
const CLOSED = "2026-11-06T18:00:00Z";

describe("pollMetaLine", () => {
  it("gives an open poll its deadline with the time", () => {
    expect(
      pollMetaLine(
        {
          channelName: "general",
          isMultiChoice: false,
          isExpired: false,
          expiresAt: EXPIRES,
        },
        NOW,
      ),
    ).toBe(`#general · Single choice · Closes ${formatDayTime(EXPIRES, NOW)}`);
  });

  it("gives a poll past its deadline the day alone", () => {
    expect(
      pollMetaLine(
        {
          channelName: "general",
          isMultiChoice: true,
          isExpired: true,
          expiresAt: EXPIRES,
        },
        NOW,
      ),
    ).toBe(`#general · Multi-choice · Closed ${formatDay(EXPIRES, NOW)}`);
  });

  it("prefers a manual close over a still-future deadline (#379)", () => {
    const line = pollMetaLine(
      {
        channelName: "general",
        isMultiChoice: false,
        isExpired: true,
        expiresAt: "2099-06-01T00:00:00Z",
        closedAt: CLOSED,
      },
      NOW,
    );
    expect(line).toBe(
      `#general · Single choice · Closed ${formatDay(CLOSED, NOW)}`,
    );
    expect(line).not.toContain("2099");
  });

  it("drops absent facts instead of printing a placeholder", () => {
    expect(
      pollMetaLine(
        { channelName: null, isMultiChoice: false, isExpired: false },
        NOW,
      ),
    ).toBe("Single choice");
    expect(
      pollMetaLine(
        {
          channelName: null,
          isMultiChoice: false,
          isExpired: false,
          expiresAt: "not a date",
        },
        NOW,
      ),
    ).toBe("Single choice");
  });

  it("never prints seconds or a numeric date", () => {
    const line = pollMetaLine(
      {
        channelName: "general",
        isMultiChoice: false,
        isExpired: false,
        expiresAt: EXPIRES,
      },
      NOW,
    );
    expect(line).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(line).not.toMatch(/\d:\d{2}:\d{2}/);
  });
});
