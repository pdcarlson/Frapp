import { describe, expect, it } from "vitest";
import {
  SETTINGS_ENTRY_PERMISSIONS,
  SETTINGS_TOOLS,
  hasSettingsDestination,
  isSettingsTabVisible,
  visibleSettingsTools,
} from "./settings-access";

/**
 * Who Settings is for (#2946). The nav's Settings row, the rail and the empty
 * state all answer from this module, so these pin its answers per seeded role
 * (`apps/api/src/domain/constants/permissions.ts`).
 */

const TREASURER = [
  "billing:view",
  "billing:manage",
  "points:adjust",
  "points:view_all",
  "polls:view_all",
  "members:view",
  "reports:export",
  "events:create",
  "events:update",
];
const MEMBER = ["members:view", "backwork:upload", "service:log", "polls:create"];

describe("SETTINGS_ENTRY_PERMISSIONS", () => {
  it("admits exactly the holders Settings has something for", () => {
    expect([...SETTINGS_ENTRY_PERMISSIONS].sort()).toEqual(
      [
        "chapter-config:view",
        "channels:manage",
        "geofences:manage",
        "reports:export",
        "roles:manage",
        "semester:rollover",
      ].sort(),
    );
  });

  it("covers every tool, so no tool is reachable only by URL", () => {
    for (const tool of SETTINGS_TOOLS) {
      expect(SETTINGS_ENTRY_PERMISSIONS).toContain(tool.permission);
    }
  });
});

describe("isSettingsTabVisible", () => {
  it("shows every tab to the President's wildcard", () => {
    for (const tab of ["org", "theme", "roles", "danger"]) {
      expect(isSettingsTabVisible(tab, ["*"])).toBe(true);
    }
  });

  it("gives a roles:manage holder the Roles tab without chapter config", () => {
    expect(isSettingsTabVisible("roles", ["roles:manage"])).toBe(true);
    expect(isSettingsTabVisible("org", ["roles:manage"])).toBe(false);
  });

  it("gives a treasurer no setup tabs, since each would fail to load", () => {
    expect(isSettingsTabVisible("org", TREASURER)).toBe(false);
    expect(isSettingsTabVisible("roles", TREASURER)).toBe(false);
  });

  it("keeps every tab for a chapter-config:view holder, as before #2946", () => {
    expect(isSettingsTabVisible("modules", ["chapter-config:view"])).toBe(true);
    expect(isSettingsTabVisible("roles", ["chapter-config:view"])).toBe(true);
    expect(isSettingsTabVisible("danger", ["chapter-config:view"])).toBe(true);
  });

  it("gives chapter-config:manage alone nothing, since the config read needs view", () => {
    // ChapterConfigController guards the whole class on chapter-config:view,
    // so without it even the PATCH is refused.
    expect(isSettingsTabVisible("org", ["chapter-config:manage"])).toBe(false);
    expect(isSettingsTabVisible("modules", ["chapter-config:manage"])).toBe(false);
  });

  it("gives a semester:rollover holder the Semester tab and no other", () => {
    // The rollover card is the only web surface for a rollover.
    expect(isSettingsTabVisible("semester", ["semester:rollover"])).toBe(true);
    expect(isSettingsTabVisible("org", ["semester:rollover"])).toBe(false);
  });

  it("fails open while permissions are unresolved, like the nav", () => {
    expect(isSettingsTabVisible("org", undefined)).toBe(true);
    expect(isSettingsTabVisible("org", null)).toBe(true);
  });
});

describe("visibleSettingsTools", () => {
  const ids = (tools: { id: string }[]) => tools.map((tool) => tool.id);

  it("gives a treasurer Reports and nothing else", () => {
    expect(ids(visibleSettingsTools(TREASURER))).toEqual(["reports"]);
  });

  it("gives an ordinary member nothing", () => {
    expect(visibleSettingsTools(MEMBER)).toEqual([]);
  });

  it("gives the wildcard every tool, in rail order", () => {
    expect(ids(visibleSettingsTools(["*"]))).toEqual([
      "chat-admin",
      "discord-import",
      "study-zones",
      "reports",
    ]);
  });

  it("hides a tool whose module the chapter switched off", () => {
    expect(
      ids(visibleSettingsTools(["*"], (key) => key !== "reports")),
    ).not.toContain("reports");
  });

  it("does not module-gate before the chapter read resolves", () => {
    expect(ids(visibleSettingsTools(["*"], undefined))).toContain("reports");
  });
});

describe("hasSettingsDestination", () => {
  it("is true for any viewer with a tab", () => {
    expect(hasSettingsDestination(["chapter-config:view"], () => false)).toBe(true);
    expect(hasSettingsDestination(["roles:manage"])).toBe(true);
    expect(hasSettingsDestination(["semester:rollover"])).toBe(true);
  });

  it("follows a tools-only viewer's tool modules", () => {
    expect(hasSettingsDestination(TREASURER, () => true)).toBe(true);
    // Reports off: the treasurer's Settings would open onto nothing.
    expect(hasSettingsDestination(TREASURER, (key) => key !== "reports")).toBe(false);
  });

  it("is false for an ordinary member", () => {
    expect(hasSettingsDestination(MEMBER, () => true)).toBe(false);
  });

  it("fails open while permissions are unresolved, like the nav", () => {
    expect(hasSettingsDestination(undefined, () => false)).toBe(true);
  });
});
