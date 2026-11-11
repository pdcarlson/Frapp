/** @vitest-environment jsdom */
import { backRowView } from "@/test/back-row";
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
import { expectViewerScopedReads } from "@/test/service-entry-reads";

/**
 * s12's service-hours total reads `GET /v1/service-entries`, which the
 * endpoint does not scope by itself: `service-entry.controller.ts` resolves
 * `userId: isAdmin ? query.userId : userId`, so a read with no `userId` hands
 * anyone holding `service:approve` every entry in the chapter. The card
 * presents the total as the viewer's own, so the screen must ask for the
 * viewer's entries, and must wait for the viewer's id rather than firing
 * once unscoped. `service-hours-screen.spec.tsx` pins the same for s20.
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
const useServiceEntries = vi.fn<(...args: unknown[]) => unknown>(() => ({
  data: [],
  isPending: false,
  isError: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useOwnAvatarTint: () => null,
  useActiveChapterId: () => "chapter-1",
  useCurrentUser: () => currentUser,
  useViewerUserId: () => viewerUserId,
  useMyPoints: () => ({ data: undefined, isPending: true, isError: false }),
  useServiceEntries: (...args: unknown[]) => useServiceEntries(...args),
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

describe("Profile reads only the viewer's service entries", () => {
  beforeEach(() => {
    useServiceEntries.mockClear();
  });

  it("asks for the viewer's entries once the viewer is known", () => {
    viewerUserId = "user-1";
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, "user-1");
    act(() => tree.unmount());
  });

  it("sends nothing while the viewer is still unknown", () => {
    viewerUserId = null;
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, null);
    act(() => tree.unmount());
  });
});

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
    // The loaded profile also draws Edit at the far end of the row (#3387).
    expect(screenText(tree)).toMatch(/^More\n(Edit\n)?Profile/);
    expectBackRow(tree, "More", "/more");
    tree.unmount();
  });
});

/**
 * #3387. Edit (a pencil since 2026-11-05) sits at the far end of the `‹ More` row, where the board draws
 * it, and opens the edit sheet. It appears only over a loaded profile: a sheet
 * opened while loading would prefill blanks over fields already set.
 */
describe("Profile Edit (#3387)", () => {
  afterEach(() => {
    currentUser = LOADED_USER;
  });

  const editControls = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Edit profile",
    );

  it("draws Edit on the back row and presents the sheet", () => {
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

    const [edit] = editControls(tree);
    expect(edit).toBeDefined();
    // Same row as `‹ More`: the back row's own view holds both.
    expect(backRowView(tree).findAll((node) => node === edit)).toHaveLength(1);
    // A pencil, not the word (components.md § Icon-only actions), in the
    // back row's own colour: the chapter accent (the mock's), not gold.
    expect(
      edit!.findAllByType("Text" as unknown as React.ElementType),
    ).toHaveLength(0);
    expect(edit!.findByType(PencilGlyph).props.color).toBe("#DDB844");

    act(() => {
      edit!.props.onPress();
    });
    expect(present).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).not.toContain("web dashboard");
    tree.unmount();
  });

  // TanStack keeps `data` through a failed background refetch; the screen,
  // and an Edit sheet open over it, stay rather than turning into the error.
  it("keeps the profile and Edit when a background refetch fails", () => {
    currentUser = { ...LOADED_USER, isError: true, refetch: vi.fn() };
    const tree = render();

    expect(editControls(tree)).toHaveLength(1);
    expect(screenText(tree)).not.toContain("Couldn't load your profile");
    tree.unmount();
  });

  it.each([
    ["loads", { isPending: true, isError: false, data: undefined }],
    [
      "fails to load",
      { isPending: false, isError: true, data: undefined, refetch: vi.fn() },
    ],
  ])("draws no Edit, and no sheet, while the profile %s", (_state, user) => {
    currentUser = user;
    const tree = render();

    expect(editControls(tree)).toHaveLength(0);
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
      "Major",
      "Graduation",
      "City",
      "Company",
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

    expect(detailRows(tree).slice(2, 5)).toEqual([
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

    expect(detailRows(tree).slice(3, 5)).toEqual([
      ["Line", "Alpha"],
      ["line number", "14"],
    ]);
    tree.unmount();
  });

  it("says Loading for the class until the chapter's list answers", () => {
    membership = { user_id: "user-1", pledge_class_id: "pc-1", order_number: null };
    pledgeClasses = undefined;
    const tree = render();

    expect(detailRows(tree)[3]).toEqual(["Pledge class", "Loading"]);
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
      "Major",
      "Graduation",
      "City",
      "Company",
    ]);
    expect(usePledgeClasses).toHaveBeenLastCalledWith({ enabled: false });
    tree.unmount();
  });
});
