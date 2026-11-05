/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
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

function read(data: unknown, refetch = vi.fn()) {
  return {
    data,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch,
  };
}

const state = vi.hoisted(() => ({ search: [] as unknown[] }));

// One refetch per read, so a pull can be checked against each of them.
const refetches = vi.hoisted(() => ({
  members: vi.fn(),
  alumni: vi.fn(),
  search: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "c-1",
  useMembers: () => read(MEMBERS, refetches.members),
  useAlumni: (filters?: { company?: string }) =>
    read(filters?.company === "Acme" ? [CHARLES] : ALUMNI, refetches.alumni),
  useMemberSearch: (q: string) =>
    read(q ? state.search : undefined, refetches.search),
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

import DirectoryScreen, { MemberRow } from "@/app/(tabs)/directory";
import { signetDarkTokens } from "@repo/theme/signet";
import { DirectoryGlyph } from "@/components/more/more-glyphs";
import { SearchGlyph } from "@/components/search-glyph";
import { EmptyState } from "@/components/state-block";
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
  state.search = [];
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
    expect(chips(tree).trailing).toBeNull();

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

  it("draws the More hub's glyphs on its empty states, and doesn't narrate", () => {
    const tree = render();
    const body = () =>
      list(tree).props.ListEmptyComponent as React.ReactElement<{
        children: React.ReactElement<Record<string, unknown>>;
      }>;
    expect(body().props.children.type).toBe(EmptyState);
    expect(body().props.children.props).toEqual({
      glyph: DirectoryGlyph,
      title: "No actives yet",
    });

    act(() => chips(tree).onSelect("alumni"));
    act(() => chips(tree).trailing!.props.onPress());
    act(() => alumniField(tree, "Filter alumni by city")!.onChangeText("Troy"));
    expect(body().props.children.props).toEqual({
      glyph: SearchGlyph,
      title: "No alumni match the filters",
      body: "Clear a filter to see more.",
    });
  });

  it("refreshes the members, alumni and search reads on a pull (#3385)", async () => {
    const tree = render();
    const control = list(tree).props.refreshControl as React.ReactElement<{
      refresh: () => Promise<unknown>;
    }>;

    await act(async () => {
      await control.props.refresh();
    });

    for (const refetch of Object.values(refetches)) {
      expect(refetch).toHaveBeenCalledWith({ cancelRefetch: false });
    }
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

describe("s13's member rows", () => {
  const ROW: DirectoryRow = {
    userId: "u-1",
    displayName: "Marcus Reid",
    initials: "MR",
    meta: null,
    avatarUrl: null,
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
  it("draws ‹ More above the title", () => {
    const tree = render();
    // `FlatList` is a host stand-in here, so its header element is never
    // mounted; mount it on its own to press the row.
    let header!: ReactTestRenderer;
    act(() => {
      header = create(
        <FrappThemeProvider>
          {list(tree).props.ListHeaderComponent}
        </FrappThemeProvider>,
      );
    });
    // Above the title: the header reads the row first, then "Directory".
    expect(screenText(header).startsWith("‹ More\nDirectory")).toBe(true);
    expectBackRow(header, "More", "/more");
    header.unmount();
    tree.unmount();
  });
});
