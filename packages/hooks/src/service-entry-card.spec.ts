import { describe, expect, it } from "vitest";
import {
  canReadCardServiceEntry,
  readLiveServiceEntry,
  SERVICE_ENTRY_CARD_LABELS,
} from "./service-entry-card";

describe("readLiveServiceEntry", () => {
  it("reads the id and status off the entry", () => {
    expect(
      readLiveServiceEntry({
        id: "entry-1",
        status: "APPROVED",
        duration_minutes: 90,
      }),
    ).toEqual({ id: "entry-1", status: "APPROVED" });
  });

  it("is null before the read lands, or for a shape it can't draw", () => {
    expect(readLiveServiceEntry(undefined)).toBe(null);
    expect(readLiveServiceEntry({ status: "PENDING" })).toBe(null);
    expect(readLiveServiceEntry({ id: "entry-1", status: "LOST" })).toBe(null);
    // A key off Object.prototype is not a status.
    expect(readLiveServiceEntry({ id: "entry-1", status: "toString" })).toBe(
      null,
    );
  });
});

describe("canReadCardServiceEntry", () => {
  it("lets the member who logged it and a service:approve holder read it", () => {
    expect(
      canReadCardServiceEntry({
        isOwner: true,
        canApprove: false,
        canViewMembers: true,
      }),
    ).toBe(true);
    expect(
      canReadCardServiceEntry({
        isOwner: false,
        canApprove: true,
        canViewMembers: true,
      }),
    ).toBe(true);
  });

  it("asks nothing for anyone else, who would get a 403", () => {
    expect(
      canReadCardServiceEntry({
        isOwner: false,
        canApprove: false,
        canViewMembers: true,
      }),
    ).toBe(false);
  });

  it("asks nothing without members:view, which the route requires first", () => {
    expect(
      canReadCardServiceEntry({
        isOwner: true,
        canApprove: true,
        canViewMembers: false,
      }),
    ).toBe(false);
  });
});

describe("SERVICE_ENTRY_CARD_LABELS", () => {
  it("says who a pending entry waits on", () => {
    expect(SERVICE_ENTRY_CARD_LABELS).toEqual({
      PENDING: "Pending review",
      APPROVED: "Approved",
      REJECTED: "Rejected",
    });
  });
});
