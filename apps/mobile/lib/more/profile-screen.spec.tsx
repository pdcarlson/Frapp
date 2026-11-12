/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { ListRow } from "@/components/list-section";
import { PencilGlyph } from "@/components/control-glyphs";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * s15, the viewer's own Profile. Its two stat cards come from `@repo/hooks`
 * `useMyProfileStats`, mocked whole here: the reads behind them, including
 * the service read scoped to the viewer (an unscoped one hands a
 * `service:approve` holder the whole chapter's entries as their own), are
 * pinned in `packages/hooks/src/profile-stats.hook.spec.tsx`.
 *
 * It renders `app/(app)/profile.tsx` but lives here: a spec under `app/`
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

import ProfileScreen from "@/app/(app)/profile";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ProfileScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * #3022. s15 is opened from More's profile card and draws `‹ More`, in its
 * loading and error states too, so a profile that won't load still has a way
 * out.
 */
describe("Profile back row (#3022)", () => {
  afterEach(() => {
    currentUser = LOADED_USER;
  });

  it.each([
    ["loaded", LOADED_USER],
    ["loading", { isPending: true, isError: false, data: undefined }],
    [
      "failed",
      { isPending: false, isError: true, data: undefined, refetch: vi.fn() },
    ],
  ])("draws ‹ More above the title when %s", (_state, user) => {
    currentUser = user;
    const tree = render();
    expect(screenText(tree)).toMatch(/^More\nProfile/);
    expectBackRow(tree, "More", "/more");
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
          <ProfileScreen />
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

  it("draws no pencil on the back row", () => {
    const { tree } = renderWithSheet();
    expect(tree.root.findAllByType(PencilGlyph)).toHaveLength(0);
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Edit profile",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });

  it("opens the sheet from the name", () => {
    const { tree, present } = renderWithSheet();
    const [name] = nameButton(tree);
    act(() => name!.props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  it("opens the sheet from each row the member sets, and not from Email", () => {
    const { tree, present } = renderWithSheet();
    const rows = tree.root.findAllByType(ListRow);
    const tappable = rows
      .filter((row) => typeof row.props.onPress === "function")
      .map((row) => row.props.label);
    expect(tappable).toEqual([
      "Phone",
      "Major",
      "Graduation",
      "City",
      "Company",
      "Bio",
    ]);
    act(() => rows.find((row) => row.props.label === "Phone")!.props.onPress());
    expect(present).toHaveBeenCalledTimes(1);
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
  ])("draws nothing to edit, and no sheet, while the profile %s", (_state, user) => {
    currentUser = user;
    const tree = render();

    expect(nameButton(tree)).toHaveLength(0);
    expect(
      tree.root.findAll(
        (node) => (node.type as unknown) === "BottomSheetModal",
      ),
    ).toHaveLength(0);
    tree.unmount();
  });
});

/**
 * The owner's design review, 2026-11-04. The stat cards sit on the same
 * step as the Details list below them, and each Details row is a fact (label
 * quiet, value bright), not a row that opens something.
 */
describe("Profile stat cards and Details", () => {
  it("draws the stat cards in the Details list's tone", () => {
    const tree = render();
    const label = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "points",
    );
    const card = Object.assign({}, ...[label.parent!.props.style].flat());
    expect(card.backgroundColor).toBe(signetDarkTokens.color.surface.card);
    tree.unmount();
  });

  it("sets every Details row as a fact row", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow);
    expect(rows.map((row) => row.props.label)).toEqual([
      "Email",
      "Phone",
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
    return tree.root
      .findAllByType(ListRow)
      .map((row) => [row.props.label, row.props.value]);
  }

  it("draws the class and the number after Graduation, in the chapter's words", () => {
    membership = { user_id: "user-1", pledge_class_id: "pc-1", order_number: 14 };
    pledgeClasses = [{ id: "pc-1", name: "Alpha" }];
    const tree = render();

    expect(detailRows(tree).slice(3, 6)).toEqual([
      ["Graduation", "Not set"],
      ["Pledge class", "Alpha"],
      ["Fraternal order", "14"],
    ]);
    tree.unmount();
  });

  it("labels both rows with the chapter's own words, as typed", () => {
    membership = { user_id: "user-1", pledge_class_id: "pc-1", order_number: 14 };
    pledgeClasses = [{ id: "pc-1", name: "Alpha" }];
    vocabulary = { class: "Line", order: "line number" };
    const tree = render();

    expect(detailRows(tree).slice(4, 6)).toEqual([
      ["Line", "Alpha"],
      ["line number", "14"],
    ]);
    tree.unmount();
  });

  it("says Loading for the class until the chapter's list answers", () => {
    membership = { user_id: "user-1", pledge_class_id: "pc-1", order_number: null };
    pledgeClasses = undefined;
    const tree = render();

    expect(detailRows(tree)[4]).toEqual(["Pledge class", "Loading"]);
    tree.unmount();
  });

  // Both reads take `members:view`; without it neither is sent.
  it("asks for neither read, and draws neither row, without members:view", () => {
    membership = { user_id: "user-1", pledge_class_id: "pc-1", order_number: 14 };
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
    membership = { user_id: "user-1", pledge_class_id: null, order_number: null };
    const tree = render();

    expect(detailRows(tree).map(([label]) => label)).toEqual([
      "Email",
      "Phone",
      "Major",
      "Graduation",
      "City",
      "Company",
      "Bio",
    ]);
    expect(usePledgeClasses).toHaveBeenLastCalledWith({ enabled: false });
    tree.unmount();
  });
});
