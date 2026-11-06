import { describe, expect, it, vi } from "vitest";
import {
  eligibleSetupLines,
  SETUP_CHECKLIST_LINES,
  SETUP_CHECKLIST_WEB_PATH,
  selectSetupChecklist,
  type SetupChecklistInput,
} from "./setup-checklist";

// These pin the checklist's own rules, so `@repo/validation`'s beta list is
// emptied: its `dues` line would otherwise never show while dues is beta-off.
// What a beta-off module does is pinned in that package's
// `beta-off-modules.spec.ts`.
vi.mock("@repo/validation/beta-off-modules", () => ({
  BETA_OFF_MODULES: [],
  isBetaOffModule: () => false,
}));

const ALL_ON = {};
const PRESIDENT = ["*"];
const NOTHING_DONE = {
  invite: 1,
  event: 0,
  "study-zone": 0,
  document: 0,
  dues: 0,
};

function select(overrides: Partial<SetupChecklistInput> = {}) {
  return selectSetupChecklist({
    permissions: PRESIDENT,
    enabledModules: ALL_ON,
    dismissed: [],
    counts: NOTHING_DONE,
    ...overrides,
  });
}

describe("selectSetupChecklist", () => {
  it("gives a president every line, in order, none done", () => {
    const list = select();
    expect(list?.lines.map((l) => [l.key, l.label, l.done])).toEqual([
      ["invite", "Invite members", false],
      ["event", "Schedule the first event", false],
      ["study-zone", "Add a study zone", false],
      ["document", "Upload the bylaws", false],
      ["dues", "Send the first dues", false],
    ]);
    expect(list?.doneCount).toBe(0);
  });

  it("checks a line off once the real thing exists", () => {
    const list = select({ counts: { ...NOTHING_DONE, invite: 2, event: 3 } });
    expect(list?.lines.filter((l) => l.done).map((l) => l.key)).toEqual([
      "invite",
      "event",
    ]);
    expect(list?.doneCount).toBe(2);
  });

  it("doesn't count the officer as an invited member", () => {
    expect(select()?.lines[0]).toMatchObject({ key: "invite", done: false });
  });

  it("shows only the lines the viewer's permissions allow", () => {
    // The seeded Treasurer: billing and events, no invites, zones or docs.
    const list = select({
      permissions: [
        "members:view",
        "billing:view",
        "billing:manage",
        "events:create",
      ],
    });
    expect(list?.lines.map((l) => l.key)).toEqual(["event", "dues"]);
  });

  it("needs billing:view for dues, since only it reads the chapter's invoices", () => {
    const list = select({ permissions: ["billing:manage", "events:create"] });
    expect(list?.lines.map((l) => l.key)).toEqual(["event"]);
  });

  it("leaves out lines for modules the chapter has turned off", () => {
    const list = select({ enabledModules: { dues: false, geofences: false } });
    expect(list?.lines.map((l) => l.key)).toEqual([
      "invite",
      "event",
      "document",
    ]);
  });

  it("shows nothing to a member who can act on no line", () => {
    expect(select({ permissions: ["members:view"] })).toBeNull();
  });

  it("goes away once every line it shows is done", () => {
    expect(
      select({
        counts: { invite: 5, event: 1, "study-zone": 1, document: 2, dues: 9 },
      }),
    ).toBeNull();
  });

  it("stays hidden once the officer hides it", () => {
    expect(select({ dismissed: ["dues", "setup-checklist"] })).toBeNull();
    expect(select({ dismissed: ["dues"] })).not.toBeNull();
  });

  it("waits for every read instead of drawing half a list", () => {
    expect(select({ permissions: undefined })).toBeNull();
    expect(select({ enabledModules: undefined })).toBeNull();
    expect(select({ dismissed: undefined })).toBeNull();
    expect(
      select({ counts: { ...NOTHING_DONE, document: undefined } }),
    ).toBeNull();
  });

  it("doesn't wait on a list for a line the viewer can't see", () => {
    const list = select({
      permissions: ["events:create"],
      counts: { event: 0 },
    });
    expect(list?.lines.map((l) => l.key)).toEqual(["event"]);
  });
});

describe("eligibleSetupLines", () => {
  it("gates study zones on the geofences module the server checks, not hours", () => {
    expect(eligibleSetupLines(PRESIDENT, { hours: false })).toContain(
      "study-zone",
    );
    expect(eligibleSetupLines(PRESIDENT, { geofences: false })).not.toContain(
      "study-zone",
    );
  });

  it("is empty until permissions and modules have loaded", () => {
    expect(eligibleSetupLines(undefined, ALL_ON)).toEqual([]);
    expect(eligibleSetupLines(PRESIDENT, undefined)).toEqual([]);
  });
});

describe("SETUP_CHECKLIST_WEB_PATH", () => {
  it("names a web screen for every line, zones on the geofences tool", () => {
    expect(Object.keys(SETUP_CHECKLIST_WEB_PATH).sort()).toEqual(
      SETUP_CHECKLIST_LINES.map((line) => line.key).sort(),
    );
    expect(SETUP_CHECKLIST_WEB_PATH["study-zone"]).toBe("/geofences");
  });
});
