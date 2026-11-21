import { describe, expect, it } from "vitest";
import {
  isMeetingLikeName,
  minutesToWrite,
  startedEventIds,
} from "./minutes-to-write";

const NOW = Date.parse("2026-11-19T18:00:00Z");
const at = (iso: string) => iso;

describe("isMeetingLikeName", () => {
  it("reads a meeting from its name, and a social as none", () => {
    expect(isMeetingLikeName("Chapter Meeting")).toBe(true);
    expect(isMeetingLikeName("Exec")).toBe(true);
    expect(isMeetingLikeName("Recruitment committee")).toBe(true);
    expect(isMeetingLikeName("Ben Cunningham Meeting")).toBe(true);
    expect(isMeetingLikeName("Date party")).toBe(false);
    expect(isMeetingLikeName("Philanthropy 5K")).toBe(false);
  });

  it("reads a social a type word starts as no meeting", () => {
    expect(isMeetingLikeName("Exec Board")).toBe(true);
    expect(isMeetingLikeName("Committee chairs")).toBe(true);
    expect(isMeetingLikeName("Weekly Chapter 11/18")).toBe(true);
    expect(isMeetingLikeName("GBM")).toBe(true);
    for (const social of [
      "Chapter Formal",
      "Chapter BBQ",
      "Exec Board Retreat",
      "Officer Installation Dinner",
      "Committee Chair Social",
    ]) {
      expect(isMeetingLikeName(social)).toBe(false);
    }
  });
});

describe("startedEventIds", () => {
  it("joins the event ids of every read, skipping rows with none", () => {
    expect(
      [
        ...startedEventIds([{ event_id: "a" }, { event_id: null }], undefined, [
          { event_id: "b" },
          { event_id: "a" },
        ]),
      ].sort(),
    ).toEqual(["a", "b"]);
  });
});

describe("minutesToWrite", () => {
  const events = [
    {
      id: "ended",
      name: "Chapter Meeting",
      start_time: at("2026-11-18T19:00:00Z"),
      end_time: at("2026-11-18T20:00:00Z"),
    },
    {
      id: "older",
      name: "Exec Meeting",
      start_time: at("2026-11-16T20:00:00Z"),
      end_time: null,
    },
    {
      id: "social",
      name: "Date party",
      start_time: at("2026-11-17T20:00:00Z"),
    },
    {
      id: "posted",
      name: "Cabinet Meeting",
      start_time: at("2026-11-17T20:00:00Z"),
    },
    {
      id: "stale",
      name: "Chapter Meeting",
      start_time: at("2026-09-01T20:00:00Z"),
    },
    {
      id: "running",
      name: "Committee chairs",
      start_time: at("2026-11-19T17:30:00Z"),
      end_time: at("2026-11-19T19:00:00Z"),
    },
    {
      id: "soon",
      name: "Chapter Meeting",
      start_time: at("2026-11-22T00:00:00Z"),
    },
    { id: "later", name: "Exec", start_time: at("2026-11-25T00:00:00Z") },
    { id: "far", name: "Exec", start_time: at("2026-12-25T00:00:00Z") },
  ];

  it("lists meetings that ended in the last 30 days with no minutes, newest first", () => {
    const { needs } = minutesToWrite(events, new Set(["posted"]), NOW);
    expect(needs.map((event) => event.id)).toEqual(["ended", "older"]);
  });

  it("names the soonest meeting in the coming week, unless it has minutes", () => {
    expect(minutesToWrite(events, new Set(), NOW).next?.id).toBe("soon");
    expect(minutesToWrite(events, new Set(["soon"]), NOW).next?.id).toBe(
      "later",
    );
    expect(
      minutesToWrite(events, new Set(["soon", "later"]), NOW).next,
    ).toBeNull();
  });

  it("leaves out a meeting still going, and one with no readable start", () => {
    const { needs } = minutesToWrite(
      [...events, { id: "bad", name: "Exec", start_time: "" }],
      new Set(),
      NOW,
    );
    expect(needs.map((event) => event.id)).not.toContain("running");
    expect(needs.map((event) => event.id)).not.toContain("bad");
  });
});

describe("minutesToWrite, with meetings marked No minutes", () => {
  const events = [
    {
      id: "a",
      name: "Chapter Meeting",
      start_time: "2026-11-18T19:00:00Z",
      end_time: "2026-11-18T20:00:00Z",
    },
    {
      id: "b",
      name: "Exec Meeting",
      start_time: "2026-11-17T19:00:00Z",
      end_time: "2026-11-17T20:00:00Z",
    },
  ];

  it("settles a marked meeting: it leaves Needs and reads as skipped", () => {
    const result = minutesToWrite(events, new Set(), NOW, new Set(["b"]));
    expect(result.needs.map((e) => e.id)).toEqual(["a"]);
    expect(result.skipped.map((e) => e.id)).toEqual(["b"]);
  });

  it("lets minutes win over the mark", () => {
    const result = minutesToWrite(events, new Set(["b"]), NOW, new Set(["b"]));
    expect(result.skipped).toEqual([]);
  });
});
