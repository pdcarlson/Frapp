import { describe, expect, it } from "vitest";
import {
  inviteMenuActions,
  listedInvites,
  type InviteListItem,
} from "./use-invites";

describe("listedInvites", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const row = (
    status: InviteListItem["status"],
    created_at: string,
  ): InviteListItem =>
    ({
      id: `${status}-${created_at}`,
      status,
      created_at,
    }) as InviteListItem;

  it("keeps every pending invite, recent joined and expired ones, and no revoked ones", () => {
    const rows = [
      row("pending", "2026-10-01T00:00:00Z"),
      row("joined", "2026-11-19T00:00:00Z"),
      row("joined", "2026-11-01T00:00:00Z"),
      row("expired", "2026-11-18T00:00:00Z"),
      row("revoked", "2026-11-19T00:00:00Z"),
    ];

    expect(listedInvites(rows, now).map((r) => r.id)).toEqual([
      "pending-2026-10-01T00:00:00Z",
      "joined-2026-11-19T00:00:00Z",
      "expired-2026-11-18T00:00:00Z",
    ]);
  });
});

describe("inviteMenuActions", () => {
  it("offers link and revoke on a pending link, and Send again only with an address", () => {
    expect(inviteMenuActions({ status: "pending", email: null })).toEqual([
      "link",
      "revoke",
    ]);
    expect(inviteMenuActions({ status: "pending", email: "a@x.edu" })).toEqual([
      "link",
      "again",
      "revoke",
    ]);
  });

  it("offers only Send again on an expired emailed invite, and nothing once joined", () => {
    expect(inviteMenuActions({ status: "expired", email: "a@x.edu" })).toEqual([
      "again",
    ]);
    expect(inviteMenuActions({ status: "expired", email: null })).toEqual([]);
    expect(inviteMenuActions({ status: "joined", email: "a@x.edu" })).toEqual(
      [],
    );
  });
});
