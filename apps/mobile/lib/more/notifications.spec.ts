import { describe, expect, it } from "vitest";
import {
  categoryLabelFor,
  selectNotificationGroups,
  selectUnreadIds,
  selectUnreadNonChatCount,
} from "./notifications";

const NOW = new Date("2026-08-17T20:00:00.000Z");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "n-1",
    title: "Chapter meeting",
    body: "starts in 2 hours",
    created_at: "2026-08-17T18:00:00.000Z",
    read_at: null,
    data: { target: { screen: "event" } },
    ...overrides,
  };
}

describe("categoryLabelFor", () => {
  // The label is derived from the deep-link target because the notification row
  // does not store its category — `notifyUser` persists `payload.data` only and
  // forwards `category` to the push provider for telemetry.
  it("maps a known target screen to its drawn label", () => {
    expect(categoryLabelFor({ target: { screen: "chat" } })).toBe("Chat");
    expect(categoryLabelFor({ target: { screen: "service" } })).toBe(
      "Service hours",
    );
    expect(categoryLabelFor({ target: { screen: "event" } })).toBe("Events");
  });

  // Better no label than a guessed one: nothing in the row says what category
  // the server used, so an unmapped screen is genuinely unknown.
  it("returns null rather than guessing for an unknown or absent target", () => {
    expect(categoryLabelFor({ target: { screen: "something-new" } })).toBeNull();
    expect(categoryLabelFor({})).toBeNull();
    expect(categoryLabelFor(undefined)).toBeNull();
    expect(categoryLabelFor({ target: "chat" })).toBeNull();
  });
});

describe("selectNotificationGroups", () => {
  it("splits TODAY from EARLIER on the local calendar day", () => {
    const groups = selectNotificationGroups(
      [
        row({ id: "today", created_at: "2026-08-17T18:00:00.000Z" }),
        row({ id: "earlier", created_at: "2026-08-15T18:00:00.000Z" }),
      ],
      NOW,
    );

    expect(groups.map((group) => group.heading)).toEqual(["TODAY", "EARLIER"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["today"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["earlier"]);
  });

  // A heading over nothing is worse than no heading.
  it("drops an empty group", () => {
    const groups = selectNotificationGroups(
      [row({ id: "earlier", created_at: "2026-08-01T18:00:00.000Z" })],
      NOW,
    );
    expect(groups.map((group) => group.heading)).toEqual(["EARLIER"]);
  });

  it("orders newest first within a group", () => {
    const groups = selectNotificationGroups(
      [
        row({ id: "older", created_at: "2026-08-17T09:00:00.000Z" }),
        row({ id: "newer", created_at: "2026-08-17T18:00:00.000Z" }),
      ],
      NOW,
    );
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("marks a row unread only while read_at is absent", () => {
    const groups = selectNotificationGroups(
      [
        row({ id: "unread", read_at: null }),
        row({ id: "read", read_at: "2026-08-17T19:00:00.000Z" }),
      ],
      NOW,
    );
    const rows = groups.flatMap((group) => group.rows);
    expect(rows.find((r) => r.id === "unread")?.isUnread).toBe(true);
    expect(rows.find((r) => r.id === "read")?.isUnread).toBe(false);
  });

  it("drops a row that cannot be drawn or timestamped honestly", () => {
    const groups = selectNotificationGroups(
      [
        row({ id: null }),
        row({ id: "no-title", title: "" }),
        row({ id: "bad-date", created_at: "not-a-date" }),
        row({ id: "fine" }),
      ],
      NOW,
    );
    expect(groups.flatMap((group) => group.rows).map((r) => r.id)).toEqual([
      "fine",
    ]);
  });

  it("returns no groups for an absent payload", () => {
    expect(selectNotificationGroups(undefined, NOW)).toEqual([]);
    expect(selectNotificationGroups([], NOW)).toEqual([]);
  });
});

describe("selectUnreadIds", () => {
  it("returns only the ids Mark all read has to fan out over", () => {
    expect(
      selectUnreadIds([
        row({ id: "a", read_at: null }),
        row({ id: "b", read_at: "2026-08-17T19:00:00.000Z" }),
        row({ id: "c", read_at: null }),
      ]),
    ).toEqual(["a", "c"]);
  });

  it("returns nothing when everything is read", () => {
    expect(
      selectUnreadIds([row({ read_at: "2026-08-17T19:00:00.000Z" })]),
    ).toEqual([]);
    expect(selectUnreadIds(undefined)).toEqual([]);
  });
});

describe("selectUnreadNonChatCount", () => {
  // ChatService writes a notifications row (target.screen: "chat") for every
  // DM/group-DM/announcement message, on top of the read-receipt count
  // useChannelUnreadCounts already reflects for that channel — counting both
  // would double-count exactly those messages.
  it("excludes unread rows targeting chat", () => {
    expect(
      selectUnreadNonChatCount([
        row({ id: "a", read_at: null, data: { target: { screen: "event" } } }),
        row({ id: "b", read_at: null, data: { target: { screen: "chat" } } }),
        row({ id: "c", read_at: null, data: { target: { screen: "tasks" } } }),
      ]),
    ).toBe(2);
  });

  it("still ignores read rows regardless of target", () => {
    expect(
      selectUnreadNonChatCount([
        row({ read_at: "2026-08-17T19:00:00.000Z" }),
        row({ read_at: "2026-08-17T19:00:00.000Z", data: { target: { screen: "chat" } } }),
      ]),
    ).toBe(0);
    expect(selectUnreadNonChatCount(undefined)).toBe(0);
  });
});
