import { describe, expect, it } from "vitest";
import {
  AWAY_AFTER_MS,
  announcementChannelIds,
  awayRows,
  awaySince,
  awaySinceLabel,
} from "./away-updates";

const SINCE = Date.parse("2026-11-17T21:40:00");
const after = (minutes: number) =>
  new Date(SINCE + minutes * 60_000).toISOString();
const channels = [
  { id: "gen", name: "general" },
  { id: "ann", name: "announcements" },
  { id: "intra", name: "intramurals" },
  { id: "exec", name: "exec" },
  { id: "quiet", name: "philanthropy" },
];
const counts = (unreadCount: number, mentionCount = 0) => ({
  unreadCount,
  mentionCount,
});
const base = {
  channels,
  announcementIds: new Set(["ann"]),
  mutedIds: new Set<string>(),
  since: SINCE,
  latestAt: new Map(channels.map((c) => [c.id, after(60)])),
};

describe("awayRows", () => {
  it("puts mentions first, then announcements, then the busiest, up to three", () => {
    const rows = awayRows({
      ...base,
      unread: new Map([
        ["gen", counts(40)],
        ["ann", counts(1)],
        ["intra", counts(23)],
        ["exec", counts(3, 2)],
      ]),
      previewOf: (id) =>
        id === "exec" ? "Jordan: Is the budget final?" : null,
    });
    expect(rows.map((row) => [row.channelId, row.kind, row.mentions])).toEqual([
      ["exec", "mention", 2],
      ["ann", "announcement", 0],
      ["gen", "busy", 0],
    ]);
    expect(rows[0]?.preview).toBe("Jordan: Is the budget final?");
  });

  it("leaves out what is older than the absence", () => {
    const rows = awayRows({
      ...base,
      unread: new Map([
        ["gen", counts(40)],
        ["exec", counts(1, 1)],
      ]),
      latestAt: new Map([
        ["gen", after(-30)],
        ["exec", after(10)],
      ]),
    });
    expect(rows.map((row) => row.channelId)).toEqual(["exec"]);
  });

  it("keeps a muted channel quiet unless the member was named", () => {
    const rows = awayRows({
      ...base,
      unread: new Map([
        ["quiet", counts(9)],
        ["intra", counts(4, 1)],
      ]),
      mutedIds: new Set(["quiet", "intra"]),
    });
    expect(rows.map((row) => row.channelId)).toEqual(["intra"]);
  });

  it("lists no busy channel while the member's muting is unknown", () => {
    const rows = awayRows({
      ...base,
      unread: new Map([
        ["gen", counts(40)],
        ["ann", counts(1)],
      ]),
      mutedIds: undefined,
    });
    expect(rows.map((row) => row.channelId)).toEqual(["ann"]);
  });

  it("lists only the channels it opened with, so it never fills back up", () => {
    const rows = awayRows({
      ...base,
      unread: new Map([
        ["gen", counts(40)],
        ["intra", counts(3)],
      ]),
      onlyIds: new Set(["intra"]),
    });
    expect(rows.map((row) => row.channelId)).toEqual(["intra"]);
  });

  it("is empty once everything is read", () => {
    expect(awayRows({ ...base, unread: new Map() })).toEqual([]);
  });
});

describe("awaySince", () => {
  const now = Date.parse("2026-11-18T15:00:00");
  it("is the last visit after eight hours away, else nothing", () => {
    expect(awaySince(now - AWAY_AFTER_MS, now)).toBe(now - AWAY_AFTER_MS);
    expect(awaySince(now - AWAY_AFTER_MS + 1, now)).toBeNull();
    expect(awaySince(null, now)).toBeNull();
    expect(awaySince(Number.NaN, now)).toBeNull();
  });

  it("says when, the way a person would", () => {
    expect(awaySinceLabel(SINCE, now)).toMatch(/^since yesterday 9:40/);
    expect(awaySinceLabel(Date.parse("2026-11-18T06:15:00"), now)).toMatch(
      /^since 6:15/,
    );
    expect(awaySinceLabel(Date.parse("2026-11-16T09:00:00"), now)).toMatch(
      /^since Monday 9/,
    );
    expect(awaySinceLabel(Date.parse("2026-10-02T09:00:00"), now)).toBe(
      "since October 2",
    );
  });
});

describe("announcementChannelIds", () => {
  it("finds the public, read-only announcements channel in the raw list", () => {
    expect(
      announcementChannelIds([
        {
          id: "ann",
          name: "announcements",
          type: "PUBLIC",
          is_read_only: true,
        },
        {
          id: "open",
          name: "announcements-chat",
          type: "PUBLIC",
          is_read_only: false,
        },
        {
          id: "priv",
          name: "exec-announcements",
          type: "PRIVATE",
          is_read_only: true,
        },
        null,
        "junk",
      ]),
    ).toEqual(new Set(["ann"]));
    expect(announcementChannelIds(undefined)).toEqual(new Set());
  });
});
