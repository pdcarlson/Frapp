import { describe, expect, it } from "vitest";
import {
  SETTINGS_INDEX,
  isSettingListed,
  searchSettings,
  settingEntryById,
  settingWebPath,
  type SettingsSearchContext,
} from "./settings-search";
import { buildFindResults } from "./find-results";

const PRESIDENT: SettingsSearchContext = {
  permissions: ["*"],
  platform: "web",
  aiAvailable: true,
  isModuleEnabled: () => true,
};
const MEMBER: SettingsSearchContext = {
  permissions: ["members:view"],
  platform: "web",
  aiAvailable: true,
  isModuleEnabled: () => true,
};
const ids = (query: string, ctx: SettingsSearchContext) =>
  searchSettings(query, ctx).map((match) => match.entry.id);

describe("settings search", () => {
  it("has unique ids", () => {
    const all = SETTINGS_INDEX.map((entry) => entry.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("finds a field inside a page by a synonym", () => {
    expect(ids("donate", PRESIDENT)[0]).toBe("donation-link");
    expect(ids("rush", PRESIDENT)).toContain("module-rush");
    expect(ids("dnd", MEMBER)[0]).toBe("quiet-hours");
    expect(ids("logout", MEMBER)[0]).toBe("sign-out");
  });

  it("puts the setting's own name first", () => {
    expect(ids("roles", PRESIDENT)[0]).toBe("roles");
    expect(ids("accent", PRESIDENT)[0]).toBe("accent");
  });

  it("needs every word to match, and forgives a typo", () => {
    expect(ids("quiet hours", MEMBER)[0]).toBe("quiet-hours");
    expect(ids("quiet zebra", MEMBER)).toEqual([]);
    expect(ids("notifcations", MEMBER)).toContain("chapter-alerts");
  });

  it("lists only what the viewer can change", () => {
    expect(ids("roles", MEMBER)).not.toContain("roles");
    expect(ids("donation", MEMBER)).toEqual([]);
    const officer: SettingsSearchContext = {
      ...MEMBER,
      permissions: ["chapter-config:view", "chapter-config:manage"],
    };
    expect(ids("ai", officer)).not.toContain("chapter-ai");
    expect(ids("ai", PRESIDENT)).toContain("chapter-ai");
    expect(ids("president", officer)).not.toContain("transfer-presidency");
  });

  it("lists nothing chapter-side while the grants are unknown", () => {
    const loading = { ...PRESIDENT, permissions: undefined };
    expect(
      SETTINGS_INDEX.filter(
        (entry) => entry.area === "chapter" && isSettingListed(entry, loading),
      ),
    ).toEqual([]);
  });

  it("leaves out AI without AI, and a tool while its module is off", () => {
    expect(ids("ai", { ...PRESIDENT, aiAvailable: false })).toEqual([]);
    const zonesOff = {
      ...PRESIDENT,
      isModuleEnabled: (key: string) => key !== "geofences",
    };
    expect(ids("study zones", zonesOff)).not.toContain("study-zones");
    expect(ids("study zones", zonesOff)).toContain("module-geofences");
  });

  it("lists only what web opens on web, and everything on the phone", () => {
    // Nudges live only on the phone.
    expect(ids("nudges", MEMBER)).not.toContain("nudges");
    expect(ids("nudges", { ...MEMBER, platform: "phone" })).toContain("nudges");
    // A setting only web changes is still listed on the phone, marked so.
    const phone = searchSettings("points goal", {
      ...PRESIDENT,
      platform: "phone",
    });
    const webOnly = phone.find((m) => m.entry.id === "points-goal");
    expect(webOnly?.opensHere).toBe(false);
    const quiet = searchSettings("quiet hours", {
      ...MEMBER,
      platform: "phone",
    });
    expect(quiet[0]?.opensHere).toBe(true);
  });

  it("leaves out a module that is off for the beta", () => {
    // Dues is in BETA_OFF_MODULES: neither its page nor its amounts list.
    expect(ids("dues", PRESIDENT)).not.toContain("module-dues");
    expect(ids("dues", PRESIDENT)).not.toContain("dues-amounts");
    expect(ids("invoices", MEMBER)).not.toContain("my-invoices");
  });

  it("offers no switch for an always-on module", () => {
    expect(settingEntryById("module-chat")?.web?.anchor).toBeUndefined();
    expect(ids("disable chat", PRESIDENT)).not.toContain("module-chat");
    expect(settingEntryById("module-events")?.web?.anchor).toBe(
      "settings-module-events-switch",
    );
  });

  it("asks for the grants the page and the API both check", () => {
    const manageOnly = { ...MEMBER, permissions: ["billing:manage"] };
    expect(ids("upgrade", manageOnly)).not.toContain("plan");
    const rolloverOnly = { ...MEMBER, permissions: ["semester:rollover"] };
    expect(ids("rollover", rolloverOnly)).not.toContain("new-semester");
    const meetingsOff = {
      ...PRESIDENT,
      isModuleEnabled: (key: string) => key !== "meetings",
    };
    expect(ids("agenda", meetingsOff)).not.toContain("minutes-sections");
  });

  it("builds the web address that opens and lights it", () => {
    expect(settingWebPath(settingEntryById("donation-link")!)).toBe(
      "/settings?tab=org&setting=donation-link",
    );
    expect(settingWebPath(settingEntryById("discord-import")!)).toBe(
      "/settings?tab=chat&tool=discord-import&setting=discord-import",
    );
    expect(settingWebPath(settingEntryById("quiet-hours")!)).toBe(
      "/preferences?section=notifications&setting=quiet-hours",
    );
    expect(settingWebPath(settingEntryById("push")!)).toBeNull();
  });

  it("is the Settings group of Find, after Channels", () => {
    const rows = buildFindResults({
      query: "accent",
      filter: "All",
      channels: [{ id: "c1", name: "accent-chat" }],
      payload: {},
      settings: searchSettings("accent", PRESIDENT),
    });
    expect(rows.map((row) => row.group)).toEqual(["Channels", "Settings"]);
    expect(rows[1]).toMatchObject({
      label: "Accent color",
      hint: "Chapter settings · Chapter",
      target: { type: "setting", settingId: "accent" },
    });
  });
});
