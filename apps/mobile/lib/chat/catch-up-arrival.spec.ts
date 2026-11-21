import { describe, expect, it } from "vitest";
import { arrivalUnread } from "./catch-up-arrival";

/** How many messages were new at the door, for Catch me up (#3946). */
describe("arrivalUnread", () => {
  const counts = [
    { channel_id: "c1", unread_count: 42 },
    { channel_id: "c2", unread_count: 0 },
  ];

  it("reads the channel's count from what Chat home holds", () => {
    expect(arrivalUnread(counts, "c1")).toBe(42);
    expect(arrivalUnread(counts, "c2")).toBe(0);
  });

  it("says unknown, never zero, when the counts aren't held or hold no row", () => {
    expect(arrivalUnread(undefined, "c1")).toBeNull();
    expect(arrivalUnread({ items: counts }, "c1")).toBeNull();
    expect(arrivalUnread(counts, "c9")).toBeNull();
    expect(arrivalUnread(counts, null)).toBeNull();
  });

  it("refuses a count that isn't one", () => {
    expect(
      arrivalUnread([{ channel_id: "c1", unread_count: "42" }], "c1"),
    ).toBeNull();
    expect(
      arrivalUnread([null, { channel_id: "c1", unread_count: -1 }], "c1"),
    ).toBeNull();
  });
});
