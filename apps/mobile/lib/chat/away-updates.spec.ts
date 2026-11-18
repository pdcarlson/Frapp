import { describe, expect, it } from "vitest";
import {
  AWAY_AFTER_MS,
  announcementChannelIds,
  awayRows,
  awaySince,
  awaySinceLabel,
} from "./away-updates";

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

describe("awayRows", () => {
  it("puts mentions first, then announcements, then the busiest, up to three", () => {
    const rows = awayRows({
      channels,
      unread: new Map([
        ["gen", counts(40)],
        ["ann", counts(1)],
        ["intra", counts(23)],
        ["exec", counts(3, 2)],
      ]),
      announcementIds: new Set(["ann"]),
      latest: [
        {
          channel_id: "exec",
          author_name: "Jordan",
          content: "Is the  budget\nfinal?",
        },
      ],
    });
    expect(rows.map((row) => [row.channelId, row.kind, row.count])).toEqual([
      ["exec", "mention", 2],
      ["ann", "announcement", 1],
      ["gen", "busy", 40],
    ]);
    expect(rows[0]?.preview).toBe("Jordan: Is the budget final?");
    expect(rows[1]?.preview).toBeNull();
  });

  it("leaves out read channels and muted ones, unless the member was named", () => {
    const rows = awayRows({
      channels,
      unread: new Map([
        ["gen", counts(0)],
        ["quiet", counts(9)],
        ["intra", counts(4, 1)],
      ]),
      announcementIds: new Set(),
      mutedIds: new Set(["quiet", "intra"]),
    });
    expect(rows.map((row) => row.channelId)).toEqual(["intra"]);
  });

  it("is empty once everything is read", () => {
    expect(
      awayRows({
        channels,
        unread: new Map(),
        announcementIds: new Set(["ann"]),
      }),
    ).toEqual([]);
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
    const at = (iso: string) => Date.parse(iso);
    expect(awaySinceLabel(at("2026-11-17T21:40:00"), now)).toBe(
      "since yesterday 9:40 PM",
    );
    expect(awaySinceLabel(at("2026-11-18T06:15:00"), now)).toBe(
      "since 6:15 AM",
    );
    expect(awaySinceLabel(at("2026-11-16T09:00:00"), now)).toBe(
      "since Monday 9:00 AM",
    );
    expect(awaySinceLabel(at("2026-11-01T09:00:00"), now)).toBe(
      "since last week",
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

describe("awayRows, the sender", () => {
  it("names a member sender by first name from the roster", () => {
    const [row] = awayRows({
      channels: [{ id: "exec", name: "exec" }],
      unread: new Map([["exec", { unreadCount: 1, mentionCount: 1 }]]),
      announcementIds: new Set(),
      latest: [
        {
          channel_id: "exec",
          sender_id: "u1",
          author_name: null,
          content: "Budget?",
        },
      ],
      nameOf: (id) => (id === "u1" ? "Jordan Lee" : undefined),
    });
    expect(row?.preview).toBe("Jordan: Budget?");
  });
});
