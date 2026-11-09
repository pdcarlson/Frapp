import { describe, expect, it } from "vitest";
import { listedInvites, type InviteListItem } from "./use-invites";

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
