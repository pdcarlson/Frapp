/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectRoundedRipple } from "@/test/pressable-row";
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
 * It renders `app/(tabs)/more.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

// Local-time constructors throughout: CI runs this suite in UTC and in
// Asia/Tokyo, and a due day and a study week are the member's own calendar.

let permissions: string[] = [];
let events: unknown[] = [];
let sessions: unknown[] | undefined;
let invoices: unknown[] = [];
let notifications: unknown[] = [];
let hiddenFeatures = new Set<string>();
/** True while `/v1/users/me/permissions` hasn't answered. */
let permissionsLoading = false;
const hiddenFeatureCalls: unknown[][] = [];
let chapterModules: Record<string, boolean> = {};
const invoiceReadOptions: ({ enabled?: boolean } | undefined)[] = [];

// `@repo/validation`'s beta list, emptied so these specs draw More as a
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

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
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
  useCurrentUser: () => ({ data: { display_name: "Paul Carlson" } }),
  useMyPoints: () => ({ data: { balance: 1240, transactions: [] } }),
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

import MoreScreen from "@/app/(tabs)/more";
import { ListRow, ListSection } from "@/components/list-section";
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
        <MoreScreen />
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

describe("More hub clock (#2101)", () => {
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
});

describe("More hub anatomy (#1048)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 4, 12, 0, 0));
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

  it("opens on the profile card, with the name and the points balance", () => {
    const text = screenText(render());
    expect(text).toContain("Paul Carlson");
    expect(text).toContain("1,240 pts");
    expect(text.indexOf("Paul Carlson")).toBeLessThan(
      text.indexOf("Study hours"),
    );
  });

  // The profile card answers a press as a list row does (`usePressFeedback`,
  // through `PressableRow`). It sits on `surface1`, the tone of the rows
  // under it, so its iOS lift is the rows' own one step, to `card`.
  it("draws the profile card in the rows' tone, ripples it on Android and lifts it a step on iOS", () => {
    const card = render().root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityHint === "Opens your profile.",
    );
    const held = Object.assign(
      {},
      ...[card.props.style({ pressed: true })].flat(Infinity),
    ) as Record<string, unknown>;

    const resting = Object.assign(
      {},
      ...[card.props.style({ pressed: false })].flat(Infinity),
    ) as Record<string, unknown>;

    expect(resting.backgroundColor).toBe(signetDarkTokens.color.surface.card);
    expect(card.props.android_ripple?.color).toMatch(/^rgba\(/);
    // The suite's react-native stub runs as iOS.
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(held).not.toHaveProperty("opacity");
    // The ripple is rounded by a parent clip with the card's radius
    // (`PressableRow`); the card's own `overflow` would leave it square.
    expectRoundedRipple(card, signetDarkTokens.radius.card);
    // The chevron is `ListRow`'s, at the label role's size.
    const chevron = card.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "›",
    );
    expect(Object.assign({}, chevron.props.style).fontSize).toBe(
      signetDarkTokens.typography.role.label.size,
    );
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
      ["Study hours", "Service hours", "Dues", "Documents", "Directory"],
      ["Settings", "Switch chapter"],
      ["Host check-in"],
    ]);
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

  // foundations.md §6 "Where the accent goes" (2026-11-05): an icon that
  // labels a row is neutral, so member and Admin rows draw the same muted hue.
  it("draws a neutral leading glyph on every row, never the chapter accent", () => {
    permissions = ["events:update"];
    const rows = render().root.findAllByType(ListRow);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const glyph = row.props.leading as React.ReactElement<{
        color: string;
      }>;
      expect(glyph, row.props.label).toBeTruthy();
      expect(glyph.props.color, row.props.label).toBe(
        signetDarkTokens.color.text.muted,
      );
    }
  });

  // The same rule for people: the viewer's initials avatar is a raised
  // neutral fill with foreground initials, never an accent tint.
  it("draws the profile card's initials avatar neutral, never the chapter accent", () => {
    const card = render().root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityHint === "Opens your profile.",
    );
    const initials = card.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "PC",
    );
    const flatten = (style: unknown) =>
      Object.assign({}, ...[style].flat(Infinity)) as Record<string, unknown>;
    expect(flatten(initials.props.style).color).toBe(
      signetDarkTokens.color.text.foreground,
    );
    const avatar = flatten(initials.parent!.props.style);
    expect(avatar.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(avatar.borderColor).toBe(signetDarkTokens.color.border.hairline);
    const styles = JSON.stringify(
      card
        .findAll((node) => typeof node.type === "string")
        .map((node) => node.props.style ?? null),
    );
    expect(styles).not.toContain("#7FB2FF");
    expect(styles).not.toContain("#2D7BFF");
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
      "Paul Carlson",
      "Study hours",
      "Service hours",
      "Dues",
      "Documents",
      "Directory",
      "Settings",
      "Switch chapter",
    ]);
    // One chevron inside each press target.
    for (const button of buttons) {
      expect(
        button.findAll(
          (node) =>
            (node.type as unknown) === "Text" && node.props.children === "›",
        ),
      ).toHaveLength(1);
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
    expect(
      host.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "›",
      ),
    ).toHaveLength(0);
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
    expect(labels).toEqual(["Invite members", "Host check-in"]);
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

  it("draws no Invite members row for a role that can't invite", () => {
    permissions = ["members:view", "events:update"];
    expect(screenText(render())).not.toContain("Invite members");
  });

  it("tells the chapter picker that More opened it, so it draws ‹ More", () => {
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
      params: { from: "more" },
    });
  });
});
