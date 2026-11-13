import { describe, expect, it } from "vitest";
import { buildFindResults } from "./find-results";

/**
 * What each row names and the cap a caller can set. The ranking, the hints
 * and the dialog's own caps are covered through web's wrapper
 * (`apps/web/components/layout/find-results.spec.ts`).
 */
const PAYLOAD = {
  members: [
    { user_id: "u1", display_name: "Ana Ruiz" },
    { user_id: "u2", display_name: "Ana Lee" },
    { user_id: "u3", display_name: "Ana Kim" },
  ],
  messages: [{ id: "m1", content: "ana is in", channel_id: "c1" }],
  events: [{ id: "e1", name: "Ana's send-off" }],
  backwork: [{ id: "b1", title: "Ana notes" }],
};
const CHANNELS = [{ id: "c1", name: "ana-fans" }];

describe("buildFindResults", () => {
  it("names the thing each row is, for the client to open its own way", () => {
    const targets = buildFindResults({
      query: "ana",
      filter: "All",
      channels: CHANNELS,
      payload: PAYLOAD,
    }).map((row) => row.target);
    expect(targets).toContainEqual({ type: "channel", channelId: "c1" });
    expect(targets).toContainEqual({ type: "member", userId: "u1" });
    expect(targets).toContainEqual({
      type: "message",
      channelId: "c1",
      messageId: "m1",
    });
    expect(targets).toContainEqual({ type: "event", eventId: "e1" });
    expect(targets).toContainEqual({ type: "backwork", entryId: "b1" });
  });

  it("caps every group at the caller's limit when one is given", () => {
    const rows = buildFindResults({
      query: "ana",
      filter: "All",
      channels: CHANNELS,
      payload: PAYLOAD,
      groupLimit: 2,
    });
    expect(rows.filter((row) => row.group === "Members")).toHaveLength(2);
  });
});
