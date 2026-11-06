import { describe, it, expect } from "vitest";
import {
  ALL_GROUP_LIMIT,
  backworkHint,
  buildFindResults,
} from "./find-results";

const NOW = new Date("2026-11-05T12:00:00");

describe("buildFindResults", () => {
  it("returns nothing for a blank query", () => {
    expect(
      buildFindResults({
        query: "   ",
        filter: "All",
        channels: [{ id: "c1", name: "general" }],
        payload: {},
      }),
    ).toEqual([]);
  });

  it("caps each group under All and lifts the cap for one group", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      content: `cabinet ${i}`,
      channel_id: "c1",
    }));
    const all = buildFindResults({
      query: "cabinet",
      filter: "All",
      channels: [],
      payload: { messages },
    });
    expect(all).toHaveLength(ALL_GROUP_LIMIT);
    const narrowed = buildFindResults({
      query: "cabinet",
      filter: "Messages",
      channels: [],
      payload: { messages },
    });
    expect(narrowed).toHaveLength(10);
  });

  it("keeps hidden groups out even when the filter names them", () => {
    const results = buildFindResults({
      query: "hw",
      filter: "Backwork",
      channels: [],
      payload: { backwork: [{ id: "b1", title: "hw 2" }] },
      hiddenGroups: new Set(["Backwork"]),
    });
    expect(results).toEqual([]);
  });

  it("dates a message with its channel and the day it was sent", () => {
    const [hit] = buildFindResults({
      query: "kitchen",
      filter: "All",
      channels: [{ id: "c1", name: "cabinet" }],
      payload: {
        messages: [
          {
            id: "m1",
            content: "cabinet is in kitchen rn",
            channel_id: "c1",
            created_at: "2026-10-28T19:08:00",
          },
        ],
      },
      now: NOW,
    });
    expect(hit).toMatchObject({
      group: "Messages",
      hint: "#cabinet · Oct 28",
      href: "/chat?channel=c1&message=m1",
    });
  });

  it("dates an event with its start", () => {
    const [hit] = buildFindResults({
      query: "cabinet",
      filter: "All",
      channels: [],
      payload: {
        events: [
          { id: "e1", name: "Cabinet meeting", start_time: "2026-11-09T19:00:00" },
        ],
      },
      now: NOW,
    });
    expect(hit!.group).toBe("Events");
    expect(hit!.hint).toMatch(/^Mon, Nov 9 · 7:00\sPM$/);
  });
});

describe("backworkHint", () => {
  const codes = new Map([["d1", "COGS"]]);

  it("names the course, the term and the day it was added", () => {
    expect(
      backworkHint(
        {
          department_id: "d1",
          course_number: "101",
          semester: "Fall",
          year: 2025,
          created_at: "2025-09-14T12:00:00",
        },
        codes,
        NOW,
      ),
    ).toBe("COGS 101 · Fall 2025 · added Sep 14, 2025");
  });

  it("leaves out what it does not know", () => {
    expect(
      backworkHint({ department_id: "unknown", course_number: "101" }, codes, NOW),
    ).toBe("101");
    expect(backworkHint({}, codes, NOW)).toBeUndefined();
  });
});
