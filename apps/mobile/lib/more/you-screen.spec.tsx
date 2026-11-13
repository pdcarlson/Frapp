/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #2101. s09 works out three things against "now", and a tab screen is never
 * unmounted, so a `new Date()` read once would freeze each of them:
 *
 * - the Dues chip would keep an invoice "Due" after the day it fell due;
 * - the officer's Host check-in row would keep pointing at an event whose
 *   check-in window has closed;
 * - the Study hours total would keep counting last week.
 *
 * This pins that all three move on the shared ticking clock.
 *
 * The profile's head and details are stubbed here: `you-profile.spec.tsx`
 * owns them. This file is the hub's rows and the Status row.
 *
 * It renders `app/(app)/(tabs)/you.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors throughout: CI runs this suite in UTC and in
// Asia/Tokyo, and a due day and a study week are the member's own calendar.

let permissions: string[] = [];
let events: unknown[] = [];
let sessions: unknown[] | undefined;
let invoices: unknown[] = [];
let notifications: unknown[] = [];
const LOADED_USER = {
  isPending: false,
  isError: false,
  data: { display_name: "Paul Carlson" },
  refetch: () => undefined,
};
let currentUser: Record<string, unknown> = LOADED_USER;
let hiddenFeatures = new Set<string>();
/** The member's weekly study goal in minutes (#1062), from `useMyGoals`. */
let studyGoal: number | null = null;
const goalReadOptions: ({ enabled?: boolean } | undefined)[] = [];
/** True while `/v1/users/me/permissions` hasn't answered. */
let permissionsLoading = false;
const hiddenFeatureCalls: unknown[][] = [];
let chapterModules: Record<string, boolean> = {};
const invoiceReadOptions: ({ enabled?: boolean } | undefined)[] = [];

// `@repo/validation`'s beta list, emptied so these specs draw You as a
// chapter with dues on sees it. The beta's own case, dues off, sets
// `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
});

let ownStatus: Record<string, unknown> | null = { status: "online" };
vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => ownStatus,
}));

vi.mock("@/components/you/profile-sections", () => ({
  ProfileHead: "ProfileHead",
  ProfileDetails: "ProfileDetails",
  ProfileSkeleton: "ProfileSkeleton",
}));

// A host node the ref lands on, so `createNodeMock` can stand in for the sheet.
vi.mock("@/components/account/status-sheet", async () => {
  const { createElement, forwardRef } = await import("react");
  return {
    StatusSheet: forwardRef(function StatusSheet(_props, ref) {
      return createElement("StatusSheet", { ref });
    }),
  };
});

vi.mock("@/components/profile/edit-profile-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    EditProfileSheet: forwardRef(function EditProfileSheet() {
      return null;
    }),
  };
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useOwnAvatarTint: () => null,
  useMyGoals: (options?: { enabled?: boolean }) => {
    goalReadOptions.push(options);
    return { data: { points: null, service: null, study: studyGoal } };
  },
  useListChapters: () => ({ isSuccess: true, data: [{ id: "chapter-1" }] }),
  usePermissionList: () => permissions,
  useMyPermissions: () => ({
    data: permissionsLoading ? undefined : { permissions },
  }),
  // The rule itself is pinned in `@repo/hooks` (`unset-features.spec.tsx`).
  useHiddenUnsetFeatures: (...args: unknown[]) => {
    hiddenFeatureCalls.push(args);
    return hiddenFeatures;
  },
  useNotifications: () => ({ data: notifications }),
  useEvents: () => ({ data: events }),
  useViewerUserId: () => "user-1",
  useStudySessions: () => ({ data: sessions }),
  useInvoices: (_userId?: string, options?: { enabled?: boolean }) => {
    invoiceReadOptions.push(options);
    return { data: invoices };
  },
  useCurrentUser: () => currentUser,
  useCurrentChapter: () => ({
    data: {
      name: "FIJI Tau Nu",
      enabled_modules: chapterModules,
      theme_palette: {
        "--signet-accent-text": "#7FB2FF",
        "--signet-accent-primary": "#2D7BFF",
        "--signet-accent-on-primary": "#FFFFFF",
      },
    },
  }),
}));

import YouScreen from "@/app/(app)/(tabs)/you";
import { ForwardGlyph } from "@/components/control-glyphs";
import { LeadTile } from "@/components/lead-tile";
import { ListRow, ListSection } from "@/components/list-section";
import { ROLE_COLOR_HEXES } from "@repo/validation";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * Unmounted in `afterEach`, not at the end of each test: the shared clock is
 * module state, and a failed test's tree left subscribed would hold it at that
 * test's time for the next one.
 */
const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <YouScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

/** Past the next tick of the 30 s clock: no remount, no refetch. */
function tick() {
  act(() => {
    vi.advanceTimersByTime(90_000);
  });
}

const minutes = (at: Date, delta: number) =>
  new Date(at.getTime() + delta * 60_000).toISOString();

describe("You tab clock (#2101)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    permissions = [];
    events = [];
    sessions = undefined;
    invoices = [];
    notifications = [];
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("turns the Dues chip past due when the due day ends while the screen is up", () => {
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30));
    invoices = [
      {
        id: "inv-1",
        user_id: "user-1",
        title: "Spring dues",
        amount: 12_500,
        status: "OPEN",
        due_date: "2026-09-30",
        paid_at: null,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toMatch(/(^|\n)Due Sep 30(\n|$)/);
    expect(screenText(tree)).not.toContain("Past due");

    tick();

    expect(screenText(tree)).toMatch(/(^|\n)Past due Sep 30(\n|$)/);
  });

  it("moves Host check-in to the next event when a check-in window closes while the screen is up", () => {
    const mountedAt = new Date(2026, 8, 30, 20, 0, 0);
    vi.setSystemTime(mountedAt);
    permissions = ["events:update"];
    events = [
      // Ended 14 minutes ago, so check-in's 15-minute grace closes in one.
      {
        id: "evt-1",
        name: "Chapter meeting",
        location: null,
        start_time: minutes(mountedAt, -74),
        end_time: minutes(mountedAt, -14),
        point_value: null,
        is_mandatory: false,
      },
      {
        id: "evt-2",
        name: "Rush dinner",
        location: null,
        start_time: minutes(mountedAt, 120),
        end_time: minutes(mountedAt, 180),
        point_value: null,
        is_mandatory: false,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("Chapter meeting");
    expect(screenText(tree)).not.toContain("Rush dinner");

    tick();

    expect(screenText(tree)).toContain("Rush dinner");
    expect(screenText(tree)).not.toContain("Chapter meeting");
  });

  it("starts a new Study hours week at the week boundary while the screen is up", () => {
    // Saturday 23:59:30. The week starts on Sunday (`startOfWeek`).
    vi.setSystemTime(new Date(2026, 9, 3, 23, 59, 30));
    sessions = [
      {
        id: "session-1",
        status: "COMPLETED",
        start_time: new Date(2026, 9, 3, 10, 0).toISOString(),
        end_time: new Date(2026, 9, 3, 12, 0).toISOString(),
        total_foreground_minutes: 120,
      },
    ];
    const tree = render();
    expect(screenText(tree)).toContain("2.0 hrs");

    tick();

    expect(screenText(tree)).toContain("0.0 hrs");
    expect(screenText(tree)).not.toContain("2.0 hrs");
  });

  it("reads the week against the member's study goal when the chapter sets one (#1062)", () => {
    vi.setSystemTime(new Date(2026, 9, 3, 18, 0, 0));
    studyGoal = 360;
    sessions = [
      {
        id: "session-1",
        status: "COMPLETED",
        start_time: new Date(2026, 9, 3, 10, 0).toISOString(),
        end_time: new Date(2026, 9, 3, 14, 0).toISOString(),
        total_foreground_minutes: 240,
      },
    ];
    try {
      expect(screenText(render())).toContain("4.0 / 6.0 hrs");
    } finally {
      studyGoal = null;
    }
  });

  it("doesn't read the study goal when Study is hidden", () => {
    hiddenFeatures = new Set(["study"]);
    goalReadOptions.length = 0;
    try {
      render();
      expect(goalReadOptions.length).toBeGreaterThan(0);
      expect(goalReadOptions.every((o) => o?.enabled === false)).toBe(true);
    } finally {
      hiddenFeatures = new Set();
    }
  });
});

describe("You tab anatomy (#1048, #3839)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0));
    currentUser = LOADED_USER;
    ownStatus = { status: "online" };
    permissions = [];
    events = [];
    sessions = undefined;
    invoices = [];
    notifications = [];
  });

  afterEach(() => {
    act(() => {
      for (const tree of mounted.splice(0)) tree.unmount();
    });
    vi.useRealTimers();
  });

  it("opens on the profile's head, then Status, then the rows, and closes on Details (#3839)", () => {
    const tree = render();
    const order = tree.root
      .findAll(
        (node) =>
          (node.type as unknown) === "ProfileHead" ||
          (node.type as unknown) === "ProfileDetails" ||
          node.type === ListRow,
      )
      .map((node) =>
        node.type === ListRow ? node.props.label : String(node.type),
      );
    expect(order[0]).toBe("ProfileHead");
    expect(order[1]).toBe("Status");
    expect(order[2]).toBe("Study hours");
    expect(order.at(-1)).toBe("ProfileDetails");
    expect(screenText(tree)).toMatch(/^You/);
  });

  it("draws the skeleton head and no Details while the profile loads, and keeps every row", () => {
    currentUser = { isPending: true, isError: false, data: undefined };
    const tree = render();
    expect(
      tree.root.findAll((n) => (n.type as unknown) === "ProfileSkeleton"),
    ).toHaveLength(1);
    expect(
      tree.root.findAll((n) => (n.type as unknown) === "ProfileDetails"),
    ).toHaveLength(0);
    expect(screenText(tree)).toContain("Switch chapter");
  });

  it("says the profile failed in place of the head, and keeps every row", () => {
    currentUser = {
      isPending: false,
      isError: true,
      isFetching: false,
      data: undefined,
      refetch: vi.fn(),
    };
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Couldn't load your profile");
    expect(text).toContain("Switch chapter");
    expect(
      tree.root.findAll((n) => (n.type as unknown) === "ProfileHead"),
    ).toHaveLength(0);
    expect(
      tree.root.findAll((n) => (n.type as unknown) === "ProfileDetails"),
    ).toHaveLength(0);
  });

  it("names the picked status and its end on the Status row, and opens the sheet from it (#3845)", () => {
    ownStatus = {
      status: "dnd",
      statusEndsAt: new Date(2026, 10, 4, 15, 0, 0).toISOString(),
    };
    const present = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <YouScreen />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "StatusSheet"
              ? { present, dismiss: vi.fn() }
              : null,
        },
      );
    });
    mounted.push(tree);
    const row = tree.root.findAllByType(ListRow)[0]!;
    // Read out as "Status, Do Not Disturb": the row names what it sets.
    expect(row.props.label).toBe("Status");
    expect(row.props.value).toBe("Do Not Disturb");
    expect(row.props.description).toMatch(/3:00/);
    act(() => row.props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
  });

  it("draws labels without a description line, and names the current chapter", () => {
    const text = screenText(render());
    for (const label of [
      "Study hours",
      "Service hours",
      "Dues",
      "Documents",
      "Directory",
      "Settings",
      "Switch chapter",
    ]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("FIJI Tau Nu");
  });

  it("gives no row a description line", () => {
    const rows = render().root.findAllByType(ListRow);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.props.description).toBeUndefined();
  });

  it("groups chapter tools, then your settings and chapter, then Admin", () => {
    permissions = ["events:update"];
    const sections = render()
      .root.findAllByType(ListSection)
      .map((section) =>
        section.findAllByType(ListRow).map((row) => row.props.label),
      );
    expect(sections).toEqual([
      ["Status"],
      [
        "Study hours",
        "Service hours",
        "Dues",
        "Documents",
        "Minutes",
        "Directory",
      ],
      ["Settings", "Switch chapter"],
      ["Host check-in"],
    ]);
  });

  it("drops the Minutes row while meetings is beta-off, and for a chapter with it off", () => {
    betaOff.keys = ["meetings"];
    const labels = () =>
      render()
        .root.findAllByType(ListRow)
        .map((row) => row.props.label);
    expect(labels()).not.toContain("Minutes");
    betaOff.keys = [];
    chapterModules = { meetings: false };
    expect(labels()).not.toContain("Minutes");
  });

  it("drops the Dues row while dues is beta-off", () => {
    betaOff.keys = ["dues"];
    const labels = render()
      .root.findAllByType(ListRow)
      .map((row) => row.props.label);
    expect(labels).not.toContain("Dues");
    expect(labels).toContain("Documents");
  });

  // A member must still be able to pay an invoice the chapter already sent.
  it("keeps the Dues row for a chapter that switched dues off itself", () => {
    chapterModules = { dues: false };
    try {
      const labels = render()
        .root.findAllByType(ListRow)
        .map((row) => row.props.label);
      expect(labels).toContain("Dues");
    } finally {
      chapterModules = {};
    }
  });

  it("reads no invoices while dues is beta-off", () => {
    betaOff.keys = ["dues"];
    render();
    expect(invoiceReadOptions.at(-1)).toEqual({ enabled: false });
  });

  it("drops Study hours and Documents while nobody has set them up for this member", () => {
    hiddenFeatures = new Set(["study", "documents"]);
    try {
      const labels = render()
        .root.findAllByType(ListRow)
        .map((row) => row.props.label);
      expect(labels).not.toContain("Study hours");
      expect(labels).not.toContain("Documents");
      expect(labels).toContain("Service hours");
      expect(labels).toContain("Directory");
    } finally {
      hiddenFeatures = new Set();
    }
  });

  it("asks the setup gate with the real permissions and the chapter's modules", () => {
    permissions = ["members:view"];
    try {
      render();
      const [perms, gate] = hiddenFeatureCalls.at(-1) as [
        string[],
        ((key: string) => boolean) | undefined,
      ];
      expect(perms).toEqual(["members:view"]);
      // A module `enabled_modules` leaves out is on.
      expect(gate?.("geofences")).toBe(true);
    } finally {
      permissions = [];
    }
  });

  // `usePermissionList` says `[]` while loading, which would read as a member
  // who holds nothing and hide an officer's rows for a beat.
  it("tells the setup gate permissions are still loading, not empty", () => {
    permissionsLoading = true;
    try {
      render();
      expect(hiddenFeatureCalls.at(-1)?.[0]).toBeUndefined();
    } finally {
      permissionsLoading = false;
    }
  });

  // foundations.md §6 "A place's hue" (Paul, 2026-11-12): a row that opens a
  // place leads with that place's tile in its own fixed hue, from the role
  // palette, which has no gold and no red. Never the chapter accent. The
  // Status row's leading mark is the status dot, whose hue is the status.
  it("leads every hub row with its place's tinted tile, never the chapter accent", () => {
    permissions = ["events:update", "members:invite"];
    const rows = render().root.findAllByType(ListRow).slice(1);
    expect(rows.length).toBeGreaterThan(0);
    const paletteHexes: readonly string[] = ROLE_COLOR_HEXES;
    for (const row of rows) {
      const tile = row.props.leading as React.ReactElement<{
        hue?: string;
        on: string;
        children: React.ReactElement<{ color: string }>;
      }>;
      expect(tile.type, row.props.label).toBe(LeadTile);
      expect(tile.props.on).toBe("card");
      if (row.props.disabled) {
        // Nothing to host: the tile goes grey with the label.
        expect(tile.props.hue).toBeUndefined();
        expect(tile.props.children.props.color).toBe(
          signetDarkTokens.color.text.disabled,
        );
        continue;
      }
      expect(paletteHexes, row.props.label).toContain(tile.props.hue);
      expect(tile.props.children.props.color).toBe(tile.props.hue);
    }
  });

  it("gives each of the member's own places a hue no other one has", () => {
    const rows = render().root.findAllByType(ListRow).slice(1);
    const hues = rows.map(
      (row) =>
        (row.props.leading as React.ReactElement<{ hue: string }>).props.hue,
    );
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("has no Notifications row: the inbox is the bell on Chat home (#3362)", () => {
    notifications = [{ id: "n-1", read_at: null }];
    const tree = render();
    expect(
      tree.root.findAllByType(ListRow).map((row) => row.props.label),
    ).not.toContain("Notifications");
  });

  it("gives every row a chevron and a press target", () => {
    const tree = render();
    const buttons = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "button",
    );
    const labels = buttons.map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual([
      "Status",
      "Study hours",
      "Service hours",
      "Dues",
      "Documents",
      "Minutes",
      "Directory",
      "Settings",
      "Switch chapter",
    ]);
    // One drawn chevron inside each press target (#3628: never a typed `›`).
    for (const button of buttons) {
      expect(button.findAllByType(ForwardGlyph)).toHaveLength(1);
      expect(
        button.findAll(
          (node) =>
            (node.type as unknown) === "Text" && node.props.children === "›",
        ),
      ).toHaveLength(0);
    }
  });

  it("drops the chevron and the open-hint from a Host check-in row with nothing to host", () => {
    permissions = ["events:update"];
    const tree = render();
    const host = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Host check-in",
    );
    expect(host.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    expect(host.props.accessibilityHint).toBeUndefined();
    expect(host.props.accessibilityValue).toEqual({
      text: "No upcoming event",
    });
    expect(host.findAllByType(ForwardGlyph)).toHaveLength(0);
  });

  it("shows the Admin section only to a member who can host", () => {
    expect(screenText(render())).not.toContain("Host check-in");
    permissions = ["events:update"];
    const text = screenText(render());
    expect(text).toContain("Admin");
    expect(text).toContain("Host check-in");
    expect(text).toContain("No upcoming event");
  });

  it("gives a member who can invite an Invite members row, first in Admin", () => {
    permissions = ["members:invite"];
    const sections = render()
      .root.findAllByType(ListSection)
      .map((section) =>
        section.findAllByType(ListRow).map((row) => row.props.label),
      );
    expect(sections.at(-1)).toEqual(["Invite members"]);

    permissions = ["*"];
    const tree = render();
    const labels = tree.root
      .findAllByType(ListSection)
      .at(-1)
      ?.findAllByType(ListRow)
      .map((row) => row.props.label);
    expect(labels).toEqual([
      "Invite members",
      "Host check-in",
      "Chapter settings",
    ]);
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Invite members",
    );
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => {
      row.props.onPress();
    });
    expect(push).toHaveBeenCalledWith("/invite");
  });

  it("gives Chapter settings to whoever has a page in it, and fails closed (#4074)", () => {
    const hasRow = () => screenText(render()).includes("Chapter settings");
    // `[]` is also what the permission list is while it loads.
    permissions = [];
    expect(hasRow()).toBe(false);
    permissions = ["members:view", "events:update"];
    expect(hasRow()).toBe(false);
    // Plan and billing doesn't come to the phone, so a treasurer who holds
    // only that gets no door to an empty screen.
    permissions = ["billing:view"];
    expect(hasRow()).toBe(false);
    permissions = ["chapter-config:view"];
    expect(hasRow()).toBe(true);
    permissions = ["roles:manage"];
    const tree = render();
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Chapter settings",
    );
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => {
      row.props.onPress();
    });
    expect(push).toHaveBeenCalledWith("/chapter-settings");
  });

  it("draws no Invite members row for a role that can't invite", () => {
    permissions = ["members:view", "events:update"];
    expect(screenText(render())).not.toContain("Invite members");
  });

  it("tells the chapter picker that You opened it, so it draws ‹ You", () => {
    const row = render().root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Switch chapter",
    );
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => {
      row.props.onPress();
    });
    expect(push).toHaveBeenCalledWith({
      pathname: "/(auth)/chapter-picker",
      params: { from: "you" },
    });
  });
});
