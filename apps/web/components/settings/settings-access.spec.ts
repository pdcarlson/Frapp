import { describe, expect, it } from "vitest";
import {
  SETTINGS_ENTRY_PERMISSIONS,
  SETTINGS_TOOLS,
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
        "chapter-config:manage",
        "chapter-config:view",
        "channels:manage",
        "geofences:manage",
        "reports:export",
        "roles:manage",
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

  it("keeps every tab for a chapter-config holder, as before #2946", () => {
    expect(isSettingsTabVisible("modules", ["chapter-config:view"])).toBe(true);
    expect(isSettingsTabVisible("roles", ["chapter-config:view"])).toBe(true);
    expect(isSettingsTabVisible("semester", ["chapter-config:manage"])).toBe(true);
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
