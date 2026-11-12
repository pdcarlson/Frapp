/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSignetTokens } from "@repo/theme/signet";
import { FrappThemeProvider, typeRole } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";
import type { DirectoryRow } from "@/lib/more/directory";

/**
 * s13 on a chapter with alumni (#2484), rendered.
 *
 * `GET /v1/members` returns the whole chapter and `GET /v1/alumni` the alumni,
 * narrowed by the Alumni tab's class-year, city and company filters. The
 * alumni mock answers those filters, which the members payload can't, so the
 * filtered-alumni case below is what tells the Alumni tab reading `useAlumni`
 * apart from one splitting `useMembers` on the flag.
 *
 * It renders `app/(app)/directory.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

function profile(userId: string, name: string, isAlumni: boolean) {
  return {
    id: `m-${userId}`,
    user_id: userId,
    chapter_id: "c-1",
    role_ids: [isAlumni ? "r-alumni" : "r-member"],
    custom_role_ids: [],
    has_completed_onboarding: true,
    created_at: "2026-08-21T12:00:00.000Z",
    updated_at: "2026-08-21T12:00:00.000Z",
    display_name: name,
    avatar_url: null,
    bio: null,
    graduation_year: null,
    current_city: null,
    current_company: null,
    email: `${userId}@example.edu`,
    is_alumni: isAlumni,
  };
}

const MARCUS = profile("u-1", "Marcus Reid", false);
const ANDRE = profile("u-2", "Andre Silva", false);
const CHARLES = profile("u-3", "Charles Whitmore III", true);
const DANIEL = profile("u-4", "Daniel Kirkpatrick", true);

/** `GET /v1/members`: everyone. */
const MEMBERS = [MARCUS, CHARLES, ANDRE, DANIEL];
/** `GET /v1/alumni`: its own endpoint, its own payload. */
const ALUMNI = [CHARLES, DANIEL];

function read(data: unknown, refetch = vi.fn()) {
  if (state.pending) {
    return {
      data: undefined,
      isPending: true,
      isError: false,
      isSuccess: false,
      isFetching: true,
      refetch,
    };
  }
  return {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch,
  };
}

const state = vi.hoisted(() => ({
  chapterId: "c-1" as string | null,
  search: [] as unknown[],
  pending: false,
  permissions: [] as string[],
  // `GET /v1/members`, `GET /v1/pledge-classes` and the chapter's own
  // vocabulary, each swapped by the pledge class specs (#3939).
  members: null as unknown[] | null,
  classes: [] as { id: string; name: string }[],
  // "never": the list has not answered. "refetch": it answered, then a
  // refresh of it failed, which leaves the last list in `data`.
  classesFailed: null as null | "never" | "refetch",
  classesPending: false,
  vocabulary: undefined as Record<string, string> | undefined,
  // `GET /v1/roles`, for the Actives filters (#3971).
  roles: [] as unknown[],
  rolesError: false,
}));

// One refetch per read, so a pull can be checked against each of them.
const refetches = vi.hoisted(() => ({
  members: vi.fn(),
  alumni: vi.fn(),
  search: vi.fn(),
  classes: vi.fn(),
  roles: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
  useActiveChapterId: () => state.chapterId,
  usePermissionList: () => state.permissions,
  useRoles: () =>
    state.rolesError
      ? {
          data: undefined,
          isPending: false,
          isError: true,
          isSuccess: false,
          isFetching: false,
          refetch: refetches.roles,
        }
      : read(state.roles, refetches.roles),
  useMembers: () => read(state.members ?? MEMBERS, refetches.members),
  usePledgeClasses: () =>
    state.classesPending
      ? {
          data: undefined,
          isPending: true,
          isError: false,
          isSuccess: false,
          isFetching: true,
          refetch: refetches.classes,
        }
      : state.classesFailed
        ? {
            data: state.classesFailed === "refetch" ? state.classes : undefined,
            isPending: false,
            isError: true,
            isSuccess: false,
            isFetching: false,
            refetch: refetches.classes,
          }
        : read(state.classes, refetches.classes),
  useCurrentChapter: () => ({
    data: state.vocabulary ? { vocabulary: state.vocabulary } : undefined,
  }),
  useAlumni: (filters?: { company?: string }) =>
    read(filters?.company === "Acme" ? [CHARLES] : ALUMNI, refetches.alumni),
  // Off without a term, as the real query is, so a pull skips it then.
  useMemberSearch: (q: string) => ({
    ...read(q ? state.search : undefined, refetches.search),
    isEnabled: q.length > 0,
  }),
}));

// The back row paints the chapter accent; its value is back-row.spec.tsx's.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#CB9FFF" }),
}));

// Stubbed so the header needs none of the chapter-branding hooks they call.
// The spec reads their props off the header element the screen builds.
vi.mock("@/components/filter-chips", () => ({
  Chip: () => null,
  FilterChips: () => null,
  SearchField: () => null,
}));

vi.mock("@/components/directory/member-detail-sheet", () => ({
  MemberDetailSheet: () => null,
}));

// A props-only stand-in: the spec drives the filter it hands the screen.
vi.mock("@/components/directory/actives-filter-sheet", () => ({
  ActivesFilterSheet: () => null,
}));

import { resetListLayoutsForTests, setListLayout } from "@/lib/list-layout";
import DirectoryScreen, {
  GridLineView,
  isGridLine,
  memberPressLabel,
  MemberTile,
  toGridLines,
  type GridLine,
  MemberListSkeleton,
  MemberRow,
} from "@/app/(app)/directory";
import { ScreenReady } from "@/lib/sentry/screen-ready";
import { signetDarkTokens } from "@repo/theme/signet";
import { InlineNote } from "@/components/inline-note";
import { ActivesFilterSheet as ActivesFilterSheetStandIn } from "@/components/directory/actives-filter-sheet";
import type { ActivesFilter } from "@/lib/directory/actives-filter";
import {
  FilterChips as FilterChipsStandIn,
  SearchField as SearchFieldStandIn,
} from "@/components/filter-chips";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <DirectoryScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function list(tree: ReactTestRenderer) {
  return tree.root.find((node) => (node.type as unknown) === "FlatList");
}

/** The names the list is handed (`FlatList` is a props-only stand-in). */
function listed(tree: ReactTestRenderer): string[] {
  return (list(tree).props.data as DirectoryRow[]).map(
    (row) => row.displayName,
  );
}

/**
 * An element inside the list's `ListHeaderComponent`. The stand-in never
 * mounts that header, so it is searched as the element tree the screen built.
 */
function inHeader(
  tree: ReactTestRenderer,
  match: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): Record<string, unknown> {
  const visit = (node: unknown): Record<string, unknown> | null => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }
    if (!React.isValidElement(node)) return null;
    const element = node as React.ReactElement<Record<string, unknown>>;
    if (match(element)) return element.props;
    return visit(element.props.children);
  };
  const found = visit(list(tree).props.ListHeaderComponent);
  if (!found) throw new Error("not in the list header");
  return found;
}

function chips(tree: ReactTestRenderer) {
  return inHeader(
    tree,
    (element) => (element.type as unknown) === FilterChipsStandIn,
  ) as {
    chips: { value: string; count: number | null }[];
    onSelect: (value: string) => void;
    scroll?: boolean;
    trailing: React.ReactElement<{
      label: string;
      on: boolean;
      accessibilityState: { expanded: boolean };
      onPress: () => void;
    }> | null;
  };
}

type TrailingChip = React.ReactElement<{
  label: string;
  on: boolean;
  accessibilityLabel?: string;
  accessibilityState: Record<string, boolean>;
  onPress: () => void;
}>;

/**
 * The chips after the tabs: the Alumni tab's one Filters chip, or the Actives
 * tab's Filters chip and, when offered, its sort (a fragment of both).
 */
function trailingChips(tree: ReactTestRenderer): TrailingChip[] {
  const trailing = chips(tree).trailing as React.ReactElement<{
    children?: React.ReactNode;
  }> | null;
  if (!trailing) return [];
  if (trailing.type !== React.Fragment) return [trailing as TrailingChip];
  return React.Children.toArray(trailing.props.children).filter(
    React.isValidElement,
  ) as TrailingChip[];
}

/** The Actives tab's Filters chip (#3971). */
function activesFiltersChip(tree: ReactTestRenderer): TrailingChip {
  const chip = trailingChips(tree).find((c) =>
    c.props.label.startsWith("Filters"),
  );
  if (!chip) throw new Error("no Filters chip");
  return chip;
}

/** The alumni filter field with this label, or `null` while they're folded. */
function alumniField(tree: ReactTestRenderer, label: string) {
  try {
    return inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === label,
    ) as { onChangeText: (text: string) => void };
  } catch {
    return null;
  }
}

function countOf(tree: ReactTestRenderer, value: string) {
  return chips(tree).chips.find((chip) => chip.value === value)?.count;
}

beforeEach(() => {
  resetListLayoutsForTests();
  state.chapterId = "c-1";
  state.search = [];
  state.pending = false;
  state.permissions = [];
  state.members = null;
  state.classes = [];
  state.classesFailed = null;
  state.classesPending = false;
  state.vocabulary = undefined;
  state.roles = [];
  state.rolesError = false;
  for (const refetch of Object.values(refetches)) {
    refetch.mockReset().mockResolvedValue(undefined);
  }
});

describe("s13 Directory on a chapter with alumni (#2484)", () => {
  it("lists and counts only non-alumni on the Actives tab", () => {
    const tree = render();

    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
    expect(countOf(tree, "actives")).toBe(2);
  });

  it("lists GET /v1/alumni on the Alumni tab, and the two tabs partition the chapter", () => {
    const tree = render();
    const actives = listed(tree);

    act(() => chips(tree).onSelect("alumni"));
    const alumni = listed(tree);

    expect(alumni).toEqual(["Charles Whitmore III", "Daniel Kirkpatrick"]);
    expect(countOf(tree, "alumni")).toBe(2);
    expect(actives.filter((name) => alumni.includes(name))).toEqual([]);
    expect([...actives, ...alumni].sort()).toEqual(
      MEMBERS.map((m) => m.display_name).sort(),
    );
  });

  it("lists what GET /v1/alumni answers for the Alumni tab's filters", () => {
    const tree = render();
    act(() => chips(tree).onSelect("alumni"));
    act(() => chips(tree).trailing!.props.onPress());

    const company = alumniField(tree, "Filter alumni by company")!;
    act(() => company.onChangeText("Acme"));

    expect(listed(tree)).toEqual(["Charles Whitmore III"]);
    // A filtered list isn't the chapter's total, so the chip drops its count.
    expect(countOf(tree, "alumni")).toBeNull();
  });

  // One row that scrolls sideways, with the Filters chip at its end, rather
  // than FilterChips' default wrapping row, which is the sheets'.
  it("puts its chips on one sideways-scrolling row", () => {
    const tree = render();
    expect(chips(tree).scroll).toBe(true);
  });

  // The owner's design review, 2026-11-04: the three fields used to stack
  // under the tabs whenever the Alumni tab was up, pushing the list down.
  it("keeps the alumni fields behind a Filters chip that counts what is set", () => {
    const tree = render();
    // The Actives tab's own Filters chip (#3971), not the alumni one.
    expect(trailingChips(tree).map((c) => c.props.label)).toEqual(["Filters"]);

    act(() => chips(tree).onSelect("alumni"));
    const filters = () => chips(tree).trailing!.props;
    expect(filters().label).toBe("Filters");
    expect(filters().accessibilityState).toEqual({ expanded: false });
    expect(alumniField(tree, "Filter alumni by city")).toBeNull();

    act(() => filters().onPress());
    expect(filters().on).toBe(true);
    act(() => alumniField(tree, "Filter alumni by city")!.onChangeText("Troy"));
    act(() =>
      alumniField(tree, "Filter alumni by company")!.onChangeText("Acme"),
    );
    expect(filters().label).toBe("Filters · 2");

    // Folded away, the filters still apply and the chip still says so.
    act(() => filters().onPress());
    expect(alumniField(tree, "Filter alumni by city")).toBeNull();
    expect(filters().label).toBe("Filters · 2");
    expect(listed(tree)).toEqual(["Charles Whitmore III"]);
  });

  it("says an empty list or a filter miss in one line, with Clear filters (rule 7)", () => {
    const tree = render();
    const body = () =>
      list(tree).props.ListEmptyComponent as React.ReactElement<{
        children: React.ReactElement<{
          children: React.ReactNode;
          action?: { label: string; onPress: () => void };
        }>;
      }>;
    expect(body().props.children.type).toBe(InlineNote);
    expect(body().props.children.props.children).toBe("No actives yet.");

    act(() => chips(tree).onSelect("alumni"));
    act(() => chips(tree).trailing!.props.onPress());
    act(() => alumniField(tree, "Filter alumni by city")!.onChangeText("Troy"));
    expect(body().props.children.props.children).toBe(
      "No alumni match these filters.",
    );
    expect(body().props.children.props.action!.label).toBe("Clear filters");

    act(() => body().props.children.props.action!.onPress());
    expect(body().props.children.props.children).toBe(
      "No alumni yet. Graduated members appear here.",
    );
  });

  async function pull(tree: ReturnType<typeof render>) {
    const control = list(tree).props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;
    await act(async () => {
      await control.props.refresh();
    });
  }

  it("refreshes both lists on a pull, and skips the search with no term (#3385)", async () => {
    await pull(render());

    expect(refetches.members).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetches.alumni).toHaveBeenCalledWith({ cancelRefetch: true });
    // The class list too (#3939): rows name a class from it.
    expect(refetches.classes).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetches.search).not.toHaveBeenCalled();
  });

  it("refreshes the search results too while a term is typed (#3385)", async () => {
    state.search = [CHARLES];
    const tree = render();
    const field = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Search the directory",
    ) as { onChangeText: (text: string) => void };
    act(() => field.onChangeText("r"));

    await pull(tree);
    expect(refetches.search).toHaveBeenCalledWith({ cancelRefetch: true });
  });

  it("searches across both lists", () => {
    state.search = [CHARLES, MARCUS];
    const tree = render();

    const field = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Search the directory",
    ) as { onChangeText: (text: string) => void };
    act(() => field.onChangeText("r"));

    expect(listed(tree)).toEqual(["Charles Whitmore III", "Marcus Reid"]);
  });
});

/**
 * #3971: the Actives tab narrowed by role, graduation year, pledge class and
 * status, by web's rules, from a sheet behind its Filters chip.
 */
describe("s13's Actives filters (#3971)", () => {
  const ROLES = [
    { id: "r-member", name: "Member", color: null },
    { id: "r-rush", name: "Rush Chair", color: "#ff0000" },
    { id: "r-alumni", name: "Alumni", color: null, system_key: "ALUMNI" },
  ];
  const ACTIVES = [
    {
      ...MARCUS,
      role_ids: ["r-member", "r-rush"],
      graduation_year: 2027,
      has_completed_onboarding: true,
    },
    {
      ...ANDRE,
      role_ids: ["r-member"],
      graduation_year: 2028,
      has_completed_onboarding: false,
    },
    CHARLES,
    DANIEL,
  ];

  function sheet(tree: ReactTestRenderer) {
    return tree.root.findByType(
      ActivesFilterSheetStandIn as unknown as React.ElementType,
    ).props as {
      filter: ActivesFilter;
      onChange: (next: ActivesFilter) => void;
      roles: { id: string; name: string }[];
      years: number[];
      classes: { id: string; name: string }[];
      classWord: string;
      rolesStatus: string;
    };
  }

  function pick(tree: ReactTestRenderer, patch: Partial<ActivesFilter>) {
    act(() => sheet(tree).onChange({ ...sheet(tree).filter, ...patch }));
  }

  beforeEach(() => {
    state.roles = ROLES;
    state.members = ACTIVES;
  });

  it("hands the sheet the actives' roles (not Alumni) and years, newest first", () => {
    const tree = render();

    expect(sheet(tree).roles.map((r) => r.name)).toEqual([
      "Member",
      "Rush Chair",
    ]);
    expect(sheet(tree).years).toEqual([2028, 2027]);
  });

  it("narrows by role, year and status, and the chip counts what is set", () => {
    const tree = render();
    expect(activesFiltersChip(tree).props.label).toBe("Filters");

    pick(tree, { roleId: "r-rush" });
    expect(listed(tree)).toEqual(["Marcus Reid"]);
    expect(activesFiltersChip(tree).props.label).toBe("Filters · 1");
    expect(activesFiltersChip(tree).props.on).toBe(true);

    pick(tree, { roleId: null, graduationYear: 2028 });
    expect(listed(tree)).toEqual(["Andre Silva"]);

    pick(tree, { graduationYear: null, status: "pending" });
    expect(listed(tree)).toEqual(["Andre Silva"]);
    pick(tree, { status: "active", roleId: "r-member" });
    expect(listed(tree)).toEqual(["Marcus Reid"]);
    expect(activesFiltersChip(tree).props.label).toBe("Filters · 2");
    // The tab's count stays the chapter's actives.
    expect(countOf(tree, "actives")).toBe(2);
  });

  it("says a filter miss in one line, with Clear filters", () => {
    const tree = render();
    pick(tree, { roleId: "r-rush", status: "pending" });

    const body = () =>
      list(tree).props.ListEmptyComponent as React.ReactElement<{
        children: React.ReactElement<{
          children: React.ReactNode;
          action?: { label: string; onPress: () => void };
        }>;
      }>;
    expect(body().props.children.props.children).toBe(
      "No actives match these filters.",
    );
    act(() => body().props.children.props.action!.onPress());
    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
    expect(activesFiltersChip(tree).props.label).toBe("Filters");
  });

  it("drops a pick whose role no longer exists rather than empty the list", () => {
    const tree = render();
    pick(tree, { roleId: "r-deleted" });

    expect(sheet(tree).filter.roleId).toBeNull();
    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
  });

  it("leaves a search and the Alumni tab unfiltered", () => {
    state.search = [CHARLES, MARCUS, ANDRE];
    const tree = render();
    pick(tree, { roleId: "r-rush" });

    act(() => chips(tree).onSelect("alumni"));
    expect(listed(tree)).toEqual([
      "Charles Whitmore III",
      "Daniel Kirkpatrick",
    ]);

    const field = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Search the directory",
    ) as { onChangeText: (text: string) => void };
    act(() => field.onChangeText("a"));
    expect(listed(tree)).toHaveLength(3);
  });

  it("offers the chapter's classes under its own word, and narrows by one", () => {
    state.classes = [
      { id: "pc-alpha", name: "Alpha" },
      { id: "pc-beta", name: "Beta" },
    ];
    state.vocabulary = { class: "Line" };
    state.members = [
      { ...ACTIVES[0]!, pledge_class_id: "pc-alpha" },
      { ...ACTIVES[1]!, pledge_class_id: "pc-beta" },
      CHARLES,
      DANIEL,
    ];
    const tree = render();

    expect(sheet(tree).classes.map((c) => c.name)).toEqual(["Alpha", "Beta"]);
    expect(sheet(tree).classWord).toBe("Line");
    pick(tree, { pledgeClassId: "pc-beta" });
    expect(listed(tree)).toEqual(["Andre Silva"]);
  });

  it("tells the sheet whether the role list has answered", () => {
    expect(sheet(render()).rolesStatus).toBe("ready");

    state.rolesError = true;
    expect(sheet(render()).rolesStatus).toBe("error");
  });

  it("refreshes the role list on a pull", async () => {
    const tree = render();
    const control = list(tree).props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;
    await act(async () => {
      await control.props.refresh();
    });
    expect(refetches.roles).toHaveBeenCalledWith({ cancelRefetch: true });
  });
});

/**
 * #3939, mobile: `spec/behavior/members.md` § Pledge class and order number.
 * Read-only here. The chip is the Actives tab's trailing chip, where the
 * Alumni tab carries Filters.
 */
describe("s13's pledge classes and fraternal order (#3939)", () => {
  const CLASSES = [
    { id: "pc-alpha", name: "Alpha" },
    { id: "pc-beta", name: "Beta" },
  ];
  // Andre is in the younger class, so name order and fraternal order differ.
  const WITH_CLASSES = [
    { ...MARCUS, pledge_class_id: "pc-alpha", order_number: 1 },
    { ...ANDRE, pledge_class_id: "pc-beta", order_number: 1 },
    CHARLES,
    DANIEL,
  ];

  function orderChip(tree: ReactTestRenderer) {
    return (
      trailingChips(tree).find((c) => c.props.label.startsWith("Sort:")) ?? null
    );
  }

  function metaOf(tree: ReactTestRenderer, name: string) {
    return (list(tree).props.data as DirectoryRow[]).find(
      (row) => row.displayName === name,
    )?.meta;
  }

  it("shows a chapter with no classes and no numbers none of it", () => {
    const tree = render();

    expect(orderChip(tree)).toBeNull();
    expect(metaOf(tree, "Marcus Reid")).toBeNull();
  });

  it("names a member's class on their row", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    const tree = render();

    expect(metaOf(tree, "Marcus Reid")).toBe("Alpha");
    expect(metaOf(tree, "Andre Silva")).toBe("Beta");
  });

  it("offers the sort under the chapter's own word, as typed, and lists by it", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    state.vocabulary = { order: "roll number" };
    const tree = render();

    const chip = orderChip(tree)!;
    expect(chip.props.label).toBe("Sort: roll number");
    expect(chip.props.accessibilityLabel).toBe("Sort by roll number");
    expect(chip.props.on).toBe(false);
    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);

    act(() => chip.props.onPress());

    expect(orderChip(tree)!.props.on).toBe(true);
    expect(orderChip(tree)!.props.accessibilityState).toEqual({
      selected: true,
    });
    expect(listed(tree)).toEqual(["Marcus Reid", "Andre Silva"]);
    // Sorted by class, the rows still name it.
    expect(metaOf(tree, "Marcus Reid")).toBe("Alpha");

    act(() => orderChip(tree)!.props.onPress());
    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
  });

  it("offers the sort to a chapter that keeps numbers and no classes", () => {
    state.members = [
      { ...MARCUS, order_number: 2 },
      { ...ANDRE, order_number: 5 },
    ];
    const tree = render();

    expect(orderChip(tree)!.props.label).toBe("Sort: Fraternal order");
    act(() => orderChip(tree)!.props.onPress());
    expect(listed(tree)).toEqual(["Marcus Reid", "Andre Silva"]);
  });

  it("keeps the Alumni tab's trailing chip as Filters, and its list by name", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    const tree = render();
    act(() => orderChip(tree)!.props.onPress());

    act(() => chips(tree).onSelect("alumni"));

    expect(chips(tree).trailing!.props.label).toBe("Filters");
    expect(listed(tree)).toEqual([
      "Charles Whitmore III",
      "Daniel Kirkpatrick",
    ]);
  });

  function rerender(tree: ReactTestRenderer) {
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <DirectoryScreen />
        </FrappThemeProvider>,
      ),
    );
  }

  it("waits for the class list: no sort and no names while it loads, though the roster has", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    state.classesPending = true;
    const tree = render();

    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
    expect(orderChip(tree)).toBeNull();
    expect(metaOf(tree, "Marcus Reid")).toBeNull();

    state.classesPending = false;
    rerender(tree);
    expect(orderChip(tree)).not.toBeNull();
    expect(metaOf(tree, "Marcus Reid")).toBe("Alpha");
  });

  it("drops the sort and the class names when the class list can't be read", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    state.classesFailed = "never";
    const tree = render();

    expect(orderChip(tree)).toBeNull();
    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
    expect(metaOf(tree, "Marcus Reid")).toBeNull();
  });

  it("keeps the list it has, and the sort, when a refresh of it fails", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    const tree = render();
    act(() => orderChip(tree)!.props.onPress());

    state.classesFailed = "refetch";
    rerender(tree);

    expect(orderChip(tree)!.props.on).toBe(true);
    expect(listed(tree)).toEqual(["Marcus Reid", "Andre Silva"]);
    expect(metaOf(tree, "Marcus Reid")).toBe("Alpha");
  });

  it("offers no sort when only alumni hold a number: it would sort nothing", () => {
    state.members = [MARCUS, ANDRE, { ...CHARLES, order_number: 3 }, DANIEL];
    const tree = render();

    expect(orderChip(tree)).toBeNull();
  });

  it("lists a search by name even while the sort is on", () => {
    state.classes = CLASSES;
    state.members = WITH_CLASSES;
    state.search = WITH_CLASSES.slice(0, 2);
    const tree = render();
    act(() => orderChip(tree)!.props.onPress());
    expect(listed(tree)).toEqual(["Marcus Reid", "Andre Silva"]);

    const field = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Search the directory",
    ) as { onChangeText: (text: string) => void };
    act(() => field.onChangeText("r"));

    expect(listed(tree)).toEqual(["Andre Silva", "Marcus Reid"]);
  });
});

describe("s13's member rows", () => {
  const ROW: DirectoryRow = {
    memberId: "m-u-1",
    userId: "u-1",
    displayName: "Marcus Reid",
    initials: "MR",
    meta: null,
    avatarUrl: null,
    pledgeClassId: null,
    orderNumber: null,
  };

  function pressableOf(onPress?: () => void) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <MemberRow row={ROW} onPress={onPress} />
        </FrappThemeProvider>,
      );
    });
    return tree.root.find((node) => (node.type as unknown) === "Pressable");
  }

  // Every list row answers a press the same way (`usePressFeedback`); these
  // rows used to give none at all.
  it("ripples on Android and lifts on iOS while held, never fading", () => {
    const row = pressableOf(vi.fn());
    const held = Object.assign(
      {},
      ...[row.props.style({ pressed: true })].flat(Infinity),
    ) as Record<string, unknown>;

    expect(row.props.android_ripple?.color).toMatch(/^rgba\(/);
    // The suite's react-native stub runs as iOS.
    expect(held.backgroundColor).toBe(signetDarkTokens.color.surface.card);
    expect(held).not.toHaveProperty("opacity");
  });

  // The row pads itself by `sm` and bleeds that same `sm` into the screen
  // gutter, as Chat home's channel rows do: without the padding the ripple
  // and lift stop flush at the avatar and text, and without the bleed the
  // content moves off the gutter line.
  it("bleeds its own padding into the screen gutter", () => {
    const row = pressableOf(vi.fn());
    const resting = Object.assign(
      {},
      ...[row.props.style({ pressed: false })].flat(Infinity),
    ) as Record<string, unknown>;

    expect(resting.paddingHorizontal).toBe(signetDarkTokens.spacing.sm);
    expect(resting.marginHorizontal).toBe(-signetDarkTokens.spacing.sm);
  });

  it("gives a row with nothing to open no feedback", () => {
    const row = pressableOf(undefined);
    expect(row.props.android_ripple).toBeUndefined();
    expect(JSON.stringify(row.props.style({ pressed: true }))).not.toContain(
      signetDarkTokens.color.surface.card,
    );
  });
});

describe("s13's loading state", () => {
  // components.md §10: the skeleton is the rows it becomes, on the row's own
  // frame and hairline, with the avatar's circle where the initials land.
  it("draws member rows on the member row's frame", () => {
    let real!: ReactTestRenderer;
    let skeleton!: ReactTestRenderer;
    act(() => {
      real = create(
        <FrappThemeProvider>
          <MemberRow
            row={{
              memberId: "m-1",
              userId: "u-1",
              displayName: "Marcus Reid",
              initials: "MR",
              meta: null,
              avatarUrl: null,
              pledgeClassId: null,
              orderNumber: null,
            }}
            onPress={vi.fn()}
          />
        </FrappThemeProvider>,
      );
      skeleton = create(
        <FrappThemeProvider>
          <MemberListSkeleton label="Loading chapter members" rows={2} />
        </FrappThemeProvider>,
      );
    });
    const flat = (style: unknown) =>
      Object.assign({}, ...[style].flat(Infinity)) as Record<string, unknown>;
    const pressable = real.root.find(
      (node) => (node.type as unknown) === "Pressable",
    );
    const realRow = flat(pressable.props.style({ pressed: false }));
    const [region, firstRow] = skeleton.root.findAllByType("View" as never);

    expect(region!.props.accessibilityRole).toBe("progressbar");
    expect(region!.props.accessibilityLabel).toBe("Loading chapter members");
    const row = flat(firstRow!.props.style);
    for (const key of [
      "paddingVertical",
      "paddingHorizontal",
      "marginHorizontal",
      "minHeight",
      "borderBottomWidth",
      "gap",
    ]) {
      expect(row[key]).toBe(realRow[key]);
    }
    const [avatar] = skeleton.root.findAllByType("Animated.View" as never);
    expect(flat(avatar!.props.style).width).toBe(40);
    expect(flat(avatar!.props.style).borderRadius).toBe(20);
  });
});

describe("s13's loading label", () => {
  // writing.md §7: the skeleton is named for the list that loads. A search
  // looks across both lists, so it names neither tab's.
  const label = (tree: ReactTestRenderer) =>
    (
      list(tree).props.ListEmptyComponent as React.ReactElement<{
        label: string;
      }>
    ).props.label;

  it("marks the Directory fully shown for Sentry once the members answer (#4342)", () => {
    state.pending = true;
    const loading = render();
    expect(loading.root.findByType(ScreenReady).props.ready).toBe(false);
    act(() => loading.unmount());

    state.pending = false;
    const loaded = render();
    expect(loaded.root.findByType(ScreenReady).props.ready).toBe(true);
    act(() => loaded.unmount());

    // No chapter: its reads never go out, so the query stays pending for good.
    state.pending = true;
    state.chapterId = null;
    const noChapter = render();
    expect(noChapter.root.findByType(ScreenReady).props.ready).toBe(true);
    act(() => noChapter.unmount());
  });

  it("names the tab's list, or the search", () => {
    state.pending = true;
    const tree = render();
    expect(label(tree)).toBe("Loading chapter members");

    act(() => chips(tree).onSelect("alumni"));
    expect(label(tree)).toBe("Loading alumni directory");

    const field = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Search the directory",
    ) as { onChangeText: (text: string) => void };
    act(() => field.onChangeText("r"));
    expect(label(tree)).toBe("Searching chapter members");
  });
});

describe("s13's frame (#2485)", () => {
  it("takes the top safe-area inset itself, since no navigator header does", () => {
    // s13 opts out of ScreenShell for its FlatList, so it can't inherit the
    // shell's edges.
    const tree = render();
    const frame = tree.root.findByType(
      "SafeAreaView" as unknown as React.ElementType,
    );

    expect(frame.props.edges).toContain("top");
  });

  it("marks its title as the screen's heading, which no header supplies now", () => {
    const tree = render();
    const title = inHeader(
      tree,
      (element) => element.props.accessibilityRole === "header",
    );

    expect(title.children).toBe("Directory");
    // The same headline as every ScreenShell title: s13's own header spreads
    // the shell's screenTitleStyle because its body is a FlatList.
    expect(title.style).toEqual(
      expect.objectContaining({
        ...typeRole(getSignetTokens().typography.role.headline),
        letterSpacing: -0.3,
      }),
    );
  });
});

/** #3022. s13 draws its own header, so it draws the board's `‹ More` itself. */
describe("s13's back row (#3022)", () => {
  it("pins ‹ More above the title, outside the scrolling list", () => {
    const tree = render();
    // Pinned like every screen's capsule, so it never scrolls away: it sits
    // before the list in the tree, and the list's header starts at the title.
    expectBackRow(tree, "More", "/more");
    expect(screenText(tree).startsWith("More")).toBe(true);
    let header!: ReactTestRenderer;
    act(() => {
      header = create(
        <FrappThemeProvider>
          {list(tree).props.ListHeaderComponent}
        </FrappThemeProvider>,
      );
    });
    expect(screenText(header).startsWith("Directory")).toBe(true);
    header.unmount();
    tree.unmount();
  });
});

/** Owner ask 2026-11-06: the phone had no way in to invite. */
describe("s13's Invite members button", () => {
  function inviteButton(tree: ReactTestRenderer) {
    return tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Invite members",
    );
  }

  it("is drawn only for a role that can invite", () => {
    const member = render();
    expect(inviteButton(member)).toHaveLength(0);
    member.unmount();

    state.permissions = ["members:invite"];
    const president = render();
    expect(inviteButton(president)).toHaveLength(1);
    president.unmount();
  });

  it("opens Invite members with ‹ Directory under it", () => {
    state.permissions = ["*"];
    const tree = render();
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => inviteButton(tree)[0].props.onPress());
    expect(push).toHaveBeenCalledWith({
      pathname: "/invite",
      params: { from: "directory" },
    });
    tree.unmount();
  });

  it("pads the list so the last row clears the button", () => {
    const without = render();
    const bottom = (tree: ReactTestRenderer) =>
      (
        list(tree).props.contentContainerStyle as { paddingBottom?: number }[]
      ).reduce((sum, style) => sum + (style?.paddingBottom ?? 0), 0);
    const plain = bottom(without);
    without.unmount();
    state.permissions = ["members:invite"];
    const withButton = render();
    expect(bottom(withButton)).toBeGreaterThan(plain);
    withButton.unmount();
  });
});

/**
 * #4175: the List/Grid toggle in the title row. Grid hands the same rows to the
 * list two to a line; the pick is kept on this phone (`lib/list-layout.ts`).
 */
describe("s13 as a grid (#4175)", () => {
  const row = (n: number): DirectoryRow => ({
    memberId: `m-${n}`,
    userId: `u-${n}`,
    displayName: `Member ${n}`,
    initials: "M",
    meta: n === 1 ? "Treasurer · CS '27" : null,
    avatarUrl: null,
    pledgeClassId: null,
    orderNumber: null,
  });

  function renderNode(node: React.ReactElement): ReactTestRenderer {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
    });
    return tree;
  }

  const pressables = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "Pressable");

  it("offers List and Grid in the title row, on List until picked", () => {
    const tree = render();
    expect(
      inHeader(tree, (element) => element.props.screen === "directory"),
    ).toBeTruthy();
    expect(list(tree).props.numColumns).toBeUndefined();
    expect(listed(tree).length).toBeGreaterThan(0);
  });

  it("switches on the mounted list without changing its column count", () => {
    const tree = render();
    const names = listed(tree);
    act(() => setListLayout("directory", "grid"));
    // Same list, never re-keyed: `numColumns` stays unset (a real FlatList
    // throws when it changes), and the data becomes lines of members.
    expect(list(tree).props.numColumns).toBeUndefined();
    const lines = list(tree).props.data as GridLine[];
    expect(lines.every(isGridLine)).toBe(true);
    expect(
      lines.flatMap((line) => line.rows.map((r) => r.displayName)),
    ).toEqual(names);
  });

  it("renders a line as tiles, padding a short last line to keep its width", () => {
    act(() => setListLayout("directory", "grid"));
    const tree = render();
    const renderItem = list(tree).props.renderItem as (info: {
      item: GridLine;
      index: number;
    }) => React.ReactElement;
    const line = renderNode(
      renderItem({ item: { key: "u-1", rows: [row(1)] }, index: 0 }),
    );
    expect(line.root.findAllByType(MemberTile)).toHaveLength(1);
    expect(line.root.findAllByType(MemberRow)).toHaveLength(0);
    // One tile and one empty cell, so the lone tile is half a line wide.
    const gridLine = line.root.findByType(GridLineView);
    expect(gridLine.props.line.rows).toHaveLength(1);
    expect(
      line.root.findAll(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.style?.flex === 1 &&
          node.children.length === 0,
      ),
    ).toHaveLength(1);
  });

  it("splits rows into lines of two", () => {
    const lines = toGridLines([row(1), row(2), row(3)]);
    expect(lines.map((line) => line.rows.length)).toEqual([2, 1]);
  });

  it("names a tile with the row's own words, and shows them", () => {
    const tile = renderNode(<MemberTile row={row(1)} onPress={vi.fn()} />);
    const rowTree = renderNode(<MemberRow row={row(1)} onPress={vi.fn()} />);
    expect(pressables(tile)[0]!.props.accessibilityLabel).toBe(
      pressables(rowTree)[0]!.props.accessibilityLabel,
    );
    expect(pressables(tile)[0]!.props.accessibilityLabel).toBe(
      memberPressLabel(row(1)),
    );
    expect(screenText(tile)).toContain("Member 1");
    expect(screenText(tile)).toContain("Treasurer · CS '27");
  });
  /**
   * #4137: the row carries the member's custom status line under the name and
   * their presence dot on the avatar, as web's Directory row and the member
   * sheet do (`components.md` § Directory row). Nothing until presence has
   * synced: no dot, no claim of Offline.
   */
  describe("Directory row presence and status line (#4137)", () => {
    const AWAY = { status: "idle" as const, line: "At practice till 6" };

    it("draws the status line under the name and the dot on the avatar", () => {
      const tree = renderNode(
        <MemberRow row={row(1)} presence={AWAY} onPress={vi.fn()} />,
      );
      const text = screenText(tree);
      expect(text).toContain("At practice till 6");
      expect(text.indexOf("Member 1")).toBeLessThan(
        text.indexOf("At practice till 6"),
      );
      expect(
        tree.root.findAll(
          (node) => node.props.testID === "member-presence-idle",
        ),
      ).not.toHaveLength(0);
      expect(pressables(tree)[0]!.props.accessibilityLabel).toBe(
        memberPressLabel(row(1), AWAY),
      );
    });

    it("speaks presence and the status line before the meta line", () => {
      expect(memberPressLabel(row(1), AWAY)).toBe(
        "View Member 1's profile, Idle, At practice till 6, Treasurer · CS '27",
      );
    });

    it("draws neither before presence has synced", () => {
      const tree = renderNode(<MemberRow row={row(1)} onPress={vi.fn()} />);
      expect(screenText(tree)).not.toContain("At practice");
      expect(
        tree.root.findAll((node) =>
          String(node.props.testID ?? "").startsWith("member-presence-"),
        ),
      ).toHaveLength(0);
    });

    it("gives a tile the same line and dot", () => {
      const tile = renderNode(
        <MemberTile row={row(1)} presence={AWAY} onPress={vi.fn()} />,
      );
      expect(screenText(tile)).toContain("At practice till 6");
      expect(
        tile.root.findAll(
          (node) => node.props.testID === "member-presence-idle",
        ),
      ).not.toHaveLength(0);
    });
  });
});
