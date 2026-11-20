import { describe, expect, it } from "vitest";
import { chapterSettingsAccess } from "./chapter-settings";

// The gate on the chapter menu's Chapter settings item (Chat home) and on the
// screen's groups (#4074).
describe("chapterSettingsAccess", () => {
  it("fails closed while the role loads ([])", () => {
    expect(chapterSettingsAccess([]).any).toBe(false);
  });

  it("offers nothing to an ordinary member or a billing-only treasurer", () => {
    // Plan and billing doesn't come to the phone: no door to an empty screen.
    expect(chapterSettingsAccess(["members:view", "events:update"]).any).toBe(
      false,
    );
    expect(chapterSettingsAccess(["billing:view"]).any).toBe(false);
  });

  it("opens Roles alone to a roles:manage holder, and everything to a config viewer", () => {
    expect(chapterSettingsAccess(["roles:manage"])).toEqual({
      chapter: false,
      roles: true,
      any: true,
    });
    expect(chapterSettingsAccess(["chapter-config:view"])).toEqual({
      chapter: true,
      roles: true,
      any: true,
    });
    expect(chapterSettingsAccess(["*"]).any).toBe(true);
  });

  it("opens Roles and groups to a groups:manage holder alone", () => {
    expect(chapterSettingsAccess(["groups:manage"])).toEqual({
      chapter: false,
      roles: true,
      any: true,
    });
  });
});
