import { describe, expect, it } from "vitest";
import { modulePermissions } from "./settings-modules";

describe("modulePermissions", () => {
  it("lists a module's permissions from the registry", () => {
    expect(
      modulePermissions("events").map((entry) => entry.permission),
    ).toEqual(["events:create", "events:update", "events:delete"]);
  });

  it("leaves out the retired permissions, as the Roles page does (#5728)", () => {
    expect(modulePermissions("announcements")).toEqual([]);
    expect(
      modulePermissions("chat").map((entry) => entry.permission),
    ).not.toContain("alumni:post");
  });
});
