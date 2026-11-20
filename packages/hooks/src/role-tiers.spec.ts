import { describe, expect, it } from "vitest";
import { shownPermissionCount } from "./role-tiers";

describe("shownPermissionCount (#5728)", () => {
  it("counts what the holder's page shows as on: no wildcard, nothing hidden", () => {
    const hidden = (permission: string) => permission === "announcements:post";
    expect(
      shownPermissionCount(
        ["*", "events:create", "announcements:post", "tasks:manage"],
        hidden,
      ),
    ).toBe(2);
  });

  it("counts a repeated string once", () => {
    expect(
      shownPermissionCount(["events:create", "events:create"], () => false),
    ).toBe(1);
  });
});
