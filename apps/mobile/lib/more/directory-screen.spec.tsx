/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
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
 * It renders `app/(tabs)/directory.tsx` but lives here: a spec under `app/`
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

function read(data: unknown) {
  return {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn(),
  };
}

const state = vi.hoisted(() => ({ search: [] as unknown[] }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "c-1",
  useMembers: () => read(MEMBERS),
  useAlumni: (filters?: { company?: string }) =>
    read(filters?.company === "Acme" ? [CHARLES] : ALUMNI),
  useMemberSearch: (q: string) => (q ? read(state.search) : read(undefined)),
}));

// Stubbed so the header needs none of the chapter-branding hooks they call.
// The spec reads their props off the header element the screen builds.
vi.mock("@/components/filter-chips", () => ({
  FilterChips: () => null,
  SearchField: () => null,
}));

vi.mock("@/components/directory/member-detail-sheet", () => ({
  MemberDetailSheet: () => null,
}));

import DirectoryScreen from "@/app/(tabs)/directory";
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
  };
}

function countOf(tree: ReactTestRenderer, value: string) {
  return chips(tree).chips.find((chip) => chip.value === value)?.count;
}

beforeEach(() => {
  state.search = [];
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

    const company = inHeader(
      tree,
      (element) =>
        (element.type as unknown) === SearchFieldStandIn &&
        element.props.accessibilityLabel === "Filter alumni by company",
    ) as { onChangeText: (text: string) => void };
    act(() => company.onChangeText("Acme"));

    expect(listed(tree)).toEqual(["Charles Whitmore III"]);
    // A filtered list isn't the chapter's total, so the chip drops its count.
    expect(countOf(tree, "alumni")).toBeNull();
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
  });
});
