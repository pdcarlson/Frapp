import { describe, expect, it } from "vitest";
import { isBetaOffModule } from "@repo/validation";
import { isPermissionHidden } from "./use-hidden-permissions";

describe("isPermissionHidden (#4504)", () => {
  it("hides the AI switches until the server says it has AI", () => {
    expect(isPermissionHidden("ai:use", false)).toBe(true);
    expect(isPermissionHidden("ai:act", undefined)).toBe(true);
    expect(isPermissionHidden("ai:use", true)).toBe(false);
  });

  it("hides the Meetings switches exactly while the module is held off", () => {
    expect(isPermissionHidden("meetings:record", true)).toBe(
      isBetaOffModule("meetings"),
    );
  });

  it("leaves every other switch alone", () => {
    expect(isPermissionHidden("events:create", false)).toBe(false);
  });
});
