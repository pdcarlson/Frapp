/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { ListRow } from "@/components/list-section";
import { PencilGlyph } from "@/components/control-glyphs";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";

/**
 * The profile on the You tab (#3839): its head (photo and name) and its
 * Details, which were s15, the pushed Profile screen. The hub's rows around
 * them are `you-screen.spec.tsx`'s. The points figure and the service hours
 * come from `@repo/hooks` `useMyProfileStats`, mocked whole here: the reads behind them,
 * including the service read scoped to the viewer (an unscoped one hands a
 * `service:approve` holder the whole chapter's entries as their own), are
 * pinned in `packages/hooks/src/profile-stats.hook.spec.tsx`.
 *
 * It renders `app/(app)/(tabs)/you.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

let viewerUserId: string | null = "user-1";
const LOADED_USER = {
  isPending: false,
  isError: false,
  refetch: () => undefined,
  data: { id: "user-1", email: "member@example.test", display_name: "Alex" },
};
// Swapped by the back-row specs for s15's loading and error states.
let currentUser: Record<string, unknown> = LOADED_USER;
// The viewer's own member profile and the chapter's class list (#3939).
let membership: Record<string, unknown> | undefined;
let pledgeClasses: { id: string; name: string }[] | undefined = [];
let vocabulary: Record<string, string> | undefined;
let permissions: string[] = ["members:view"];
const useMemberByUserId = vi.fn((userId: string) => ({
  data: userId ? membership : undefined,
}));
const usePledgeClasses = vi.fn((options?: { enabled?: boolean }) =>
  options?.enabled === false || pledgeClasses === undefined
    ? { data: undefined, isPending: true, isSuccess: false }
    : { data: pledgeClasses, isPending: false, isSuccess: true },
);
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // The hub's own reads, answered empty: `you-screen.spec.tsx` owns them.
  useListChapters: () => ({ isSuccess: true, data: [{ id: "chapter-1" }] }),
  useMyPermissions: () => ({ data: { permissions } }),
  useHiddenUnsetFeatures: () => new Set<string>(),
  useNotifications: () => ({ data: [] }),
  useEvents: () => ({ data: [] }),
  useStudySessions: () => ({ data: undefined }),
  useInvoices: () => ({ data: [] }),
  useMyGoals: () => ({ data: undefined }),
  // The Edit sheet's Major suggestions (#5778) are its own spec's business.
  useChapterMajors: () => [],
  // Last week and This semester (#5779): nothing to say here.
  useActivityStanding: () => ({
    data: undefined,
    isPending: false,
    refetch: () => Promise.resolve(),
  }),
  useActivityRecap: () => ({ data: undefined }),
  useOwnAvatarTint: () => null,
  useCurrentUser: () => currentUser,
  useViewerUserId: () => viewerUserId,
  // The reads behind the cards are `profile-stats.hook.spec.tsx`'s business.
  useMyProfileStats: () => ({
    points: null,
    serviceHours: null,
    hasChapter: true,
    visible: true,
    pointsFailed: false,
    serviceFailed: false,
  }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useMemberByUserId: (userId: string) => useMemberByUserId(userId),
  usePermissionList: () => permissions,
  usePledgeClasses: (options?: { enabled?: boolean }) =>
    usePledgeClasses(options),
  useCurrentChapter: () => ({ data: vocabulary ? { vocabulary } : undefined }),
}));

vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => ({ status: "online" }),
}));

// The status sheet is `status-sheet.spec.tsx`'s; here it only has to mount.
vi.mock("@/components/account/status-sheet", async () => {
  const { forwardRef } = await import("react");
  return {
    StatusSheet: forwardRef(function StatusSheet() {
      return null;
    }),
  };
});

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ email: "member@example.test" }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

// Picking and uploading a photo is `profile-photo`'s own spec's business.
vi.mock("@/components/profile/profile-photo", () => ({
  PROFILE_PHOTO_SIZE: 84,
  ProfilePhoto: "ProfilePhoto",
}));

import YouScreen from "@/app/(app)/(tabs)/you";
import { PointsLabel } from "@/components/you/profile-sections";

/** The profile's Details rows, apart from the hub's rows around them. */
function detailListRows(tree: ReactTestRenderer) {
  return tree.root
    .findAllByType(ListRow)
    .filter((row) => row.props.variant === "detail");
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <YouScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * #3839. The profile is the You tab, so it is titled You and has no back row:
 * nothing is under a tab to go back to.
 */
describe("Profile on the You tab (#3839)", () => {
  it("is titled You, with no back row", () => {
    const tree = render();
    expect(screenText(tree)).toMatch(/^You\n/);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "View" && node.props.testID === "back-row",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });
});

/**
 * #3711 (Paul, 2026-11-07: "The pencil button isn't obvious; drop it"). There
 * is no Edit control: the name, and every Details row that is the member's to
 * set, opens the edit sheet. Email is the account's, so it doesn't. None of it
 * is drawn over a loading or failed profile: a sheet opened then would prefill
 * blanks over fields already set.
 */
describe("Profile tap to edit (#3711)", () => {
  afterEach(() => {
    currentUser = LOADED_USER;
  });

  const nameButton = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityHint === "Edits your profile",
    );

  function renderWithSheet() {
    const present = vi.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <YouScreen />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "BottomSheetModal"
              ? { present, dismiss: vi.fn() }
              : null,
        },
      );
    });
    return { tree, present };
  }

  it("draws no pencil", () => {
    const { tree } = renderWithSheet();
    expect(tree.root.findAllByType(PencilGlyph)).toHaveLength(0);
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Edit profile",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });

  /** The field the sheet was last told to open at. */
  const openAt = (tree: ReactTestRenderer) =>
    tree.root.findByType(EditProfileSheet).props.openAt;

  it("opens the sheet from the name, at Name", () => {
    const { tree, present } = renderWithSheet();
    const [name] = nameButton(tree);
    act(() => name!.props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
    expect(openAt(tree)).toBe("displayName");
    tree.unmount();
  });

  // #5280: each row opens the sheet at its own field, not at the top.
  it("opens the sheet from each row the member sets, at that row's field, and not from Email", () => {
    currentUser = {
      ...LOADED_USER,
      data: { ...LOADED_USER.data, graduation_year: 2020 },
    };
    const { tree, present } = renderWithSheet();
    const rows = detailListRows(tree).filter(
      (row) => typeof row.props.onPress === "function",
    );
    const opened = rows.map((row) => {
      act(() => row.props.onPress());
      return [row.props.label, openAt(tree)];
    });
    expect(opened).toEqual([
      ["Phone", "phone"],
      ["Birthday", "birthdayMonth"],
      ["Major", "major"],
      ["Graduation", "graduationYear"],
      ["City", "city"],
      ["Company", "company"],
      ["Bio", "bio"],
    ]);
    expect(present).toHaveBeenCalledTimes(rows.length);
    tree.unmount();
  });

  it("opens the sheet from the bio card at Bio", () => {
    currentUser = {
      ...LOADED_USER,
      data: { ...LOADED_USER.data, bio: "Hometown: Troy." },
    };
    const { tree, present } = renderWithSheet();
    const [card] = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityHint === "Opens a sheet to edit your profile",
    );
    act(() => card!.props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
    expect(openAt(tree)).toBe("bio");
    tree.unmount();
  });

  // #5280, Paul's pick 2026-11-17: City and Company follow the editor, which
  // shows them from the graduation year on (`showsAfterGraduation`), so an
  // undergrad has no row that opens a sheet without its field.
  it.each([
    ["no graduation year", {}, false],
    ["a graduation year still ahead", { graduation_year: 2099 }, false],
    ["a graduation year reached", { graduation_year: 2020 }, true],
    [
      "a year ahead and a city already set",
      { graduation_year: 2099, current_city: "Troy, NY" },
      true,
    ],
  ])("draws City and Company for %s: %s", (_case, fields, shown) => {
    currentUser = { ...LOADED_USER, data: { ...LOADED_USER.data, ...fields } };
    const tree = render();
    const labels = detailListRows(tree).map((row) => row.props.label);
    if (shown)
      expect(labels).toEqual(expect.arrayContaining(["City", "Company"]));
    else {
      expect(labels).not.toContain("City");
      expect(labels).not.toContain("Company");
    }
    tree.unmount();
  });

  // TanStack keeps `data` through a failed background refetch; the screen,
  // and an Edit sheet open over it, stay rather than turning into the error.
  it("keeps the profile and its edit taps when a background refetch fails", () => {
    currentUser = { ...LOADED_USER, isError: true, refetch: vi.fn() };
    const tree = render();

    expect(nameButton(tree)).toHaveLength(1);
    expect(screenText(tree)).not.toContain("Couldn't load your profile");
    tree.unmount();
  });

  it.each([
    ["loads", { isPending: true, isError: false, data: undefined }],
    [
      "fails to load",
      { isPending: false, isError: true, data: undefined, refetch: vi.fn() },
    ],
  ])(
    "draws nothing to edit, and no sheet, while the profile %s",
    (_state, user) => {
      currentUser = user;
      const tree = render();

      expect(nameButton(tree)).toHaveLength(0);
      expect(
        tree.root.findAll(
          (node) => (node.type as unknown) === "BottomSheetModal",
        ),
      ).toHaveLength(0);
      tree.unmount();
    },
  );
});

/**
 * The owner's design review, 2026-11-04: each Details row is a fact (label
 * quiet, value bright), not a row that opens something. Since #5281
 * (2026-11-17) the head has no stat cards.
 */
describe("Profile head and Details", () => {
  it("draws no stat cards under the name (#5281)", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).not.toMatch(/\bservice hrs\b/);
    expect(
      tree.root.findAll(
        (node) =>
          (node.type as unknown) === "Text" && node.props.children === "points",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });

  it("sets every Details row as a fact row", () => {
    currentUser = {
      ...LOADED_USER,
      data: { ...LOADED_USER.data, graduation_year: 2020 },
    };
    const tree = render();
    currentUser = LOADED_USER;
    const rows = tree.root.findAllByType(ListRow).slice(-8);
    expect(rows.map((row) => row.props.label)).toEqual([
      "Email",
      "Phone",
      "Birthday",
      "Major",
      "Graduation",
      "City",
      "Company",
      "Bio",
    ]);
    for (const row of rows) expect(row.props.variant).toBe("detail");
    tree.unmount();
  });
});

/**
 * #3939. Canvas draws a Pledge class row on s15; its source is the viewer's
 * member profile. Read-only, and drawn only when an officer has set it.
 */
describe("Profile pledge class and order number (#3939)", () => {
  beforeEach(() => {
    // An earlier suite leaves the viewer unknown.
    viewerUserId = "user-1";
  });

  afterEach(() => {
    membership = undefined;
    pledgeClasses = [];
    vocabulary = undefined;
    permissions = ["members:view"];
    usePledgeClasses.mockClear();
    useMemberByUserId.mockClear();
  });

  function detailRows(tree: ReactTestRenderer) {
    return detailListRows(tree).map((row) => [
      row.props.label,
      row.props.value,
    ]);
  }

  it("draws the class and the number after Graduation, in the chapter's words", () => {
    membership = {
      user_id: "user-1",
      pledge_class_id: "pc-1",
      order_number: 14,
    };
    pledgeClasses = [{ id: "pc-1", name: "Alpha" }];
    const tree = render();

    expect(detailRows(tree).slice(4, 7)).toEqual([
      ["Graduation", "Not set"],
      ["Pledge class", "Alpha"],
      ["Fraternal order", "14"],
    ]);
    tree.unmount();
  });

  it("labels both rows with the chapter's own words, as typed", () => {
    membership = {
      user_id: "user-1",
      pledge_class_id: "pc-1",
      order_number: 14,
    };
    pledgeClasses = [{ id: "pc-1", name: "Alpha" }];
    vocabulary = { class: "Line", order: "line number" };
    const tree = render();

    expect(detailRows(tree).slice(5, 7)).toEqual([
      ["Line", "Alpha"],
      ["line number", "14"],
    ]);
    tree.unmount();
  });

  it("says Loading for the class until the chapter's list answers", () => {
    membership = {
      user_id: "user-1",
      pledge_class_id: "pc-1",
      order_number: null,
    };
    pledgeClasses = undefined;
    const tree = render();

    expect(detailRows(tree)[5]).toEqual(["Pledge class", "Loading"]);
    tree.unmount();
  });

  // Both reads take `members:view`; without it neither is sent.
  it("asks for neither read, and draws neither row, without members:view", () => {
    membership = {
      user_id: "user-1",
      pledge_class_id: "pc-1",
      order_number: 14,
    };
    permissions = [];
    const tree = render();

    expect(useMemberByUserId).toHaveBeenLastCalledWith("");
    expect(usePledgeClasses).toHaveBeenLastCalledWith({ enabled: false });
    expect(detailRows(tree).map(([label]) => label)).not.toContain(
      "Pledge class",
    );
    tree.unmount();
  });

  it("draws neither, and reads no class list, for a member with none set", () => {
    membership = {
      user_id: "user-1",
      pledge_class_id: null,
      order_number: null,
    };
    const tree = render();

    expect(detailRows(tree).map(([label]) => label)).toEqual([
      "Email",
      "Phone",
      "Birthday",
      "Major",
      "Graduation",
      "Bio",
    ]);
    expect(usePledgeClasses).toHaveBeenLastCalledWith({ enabled: false });
    tree.unmount();
  });
});

/** #5281: the points figure at the top right of the You tab. */
describe("PointsLabel (#5281)", () => {
  function renderLabel(points: number | null, failed = false) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <PointsLabel points={points} failed={failed} />
        </FrappThemeProvider>,
      );
    });
    return tree;
  }

  it("says nothing while unknown or at zero", () => {
    expect(renderLabel(null).toJSON()).toBeNull();
    expect(renderLabel(0).toJSON()).toBeNull();
  });

  it("reads short on screen and in full to a screen reader", () => {
    const tree = renderLabel(1240);
    const text = tree.root.findByProps({ testID: "you-points" });
    expect(screenText(tree)).toContain(`${(1240).toLocaleString()} pts`);
    expect(text.props.accessibilityLabel).toBe(
      `${(1240).toLocaleString()} points`,
    );
    expect(screenText(renderLabel(1))).toContain("1 pt");
  });

  it("shows a negative balance, singular at minus one", () => {
    expect(screenText(renderLabel(-1))).toContain("-1 pt");
    expect(screenText(renderLabel(-5))).toContain("-5 pts");
  });

  it("says a failed read with a dash, not as zero", () => {
    const tree = renderLabel(null, true);
    expect(screenText(tree)).toContain("— pts");
    expect(
      tree.root.findByProps({ testID: "you-points" }).props.accessibilityLabel,
    ).toBe("Points couldn't load");
  });

  it("is never the chapter accent", () => {
    const tree = renderLabel(60);
    const style = Object.assign(
      {},
      ...[tree.root.findByProps({ testID: "you-points" }).props.style].flat(),
    );
    expect(style.color).toBe(signetDarkTokens.color.text.mutedForeground);
  });
});
