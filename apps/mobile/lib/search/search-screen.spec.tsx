/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIND_PLACEHOLDER } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The Search screen (#5139), rendered for real but for its list, which has
 * its own spec (`components/search/search-results.spec.tsx`). It lives here,
 * not beside the screen, because a spec under `app/` ships in the bundle
 * (`lib/routes.spec.ts`).
 */

const state = vi.hoisted(() => ({
  ask: true,
  modules: {} as Record<string, boolean>,
  lastResults: null as null | {
    query: string;
    filter: string;
    onOpen: (row: unknown) => void;
  },
}));

vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ ask: state.ask, ready: true }),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => "u1",
  useActiveChapterId: () => "ch1",
  useCurrentChapter: () => ({ data: { enabled_modules: state.modules } }),
}));
vi.mock("@/components/search/search-results", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/search/search-results")
  >()),
  SearchResults: (props: {
    query: string;
    filter: string;
    onOpen: (row: unknown) => void;
  }) => {
    state.lastResults = props;
    return null;
  },
}));
vi.mock("@/lib/haptics", () => ({ selectionHaptic: vi.fn() }));

import SearchScreen, {
  askAboutLabel,
  RECENT_SEARCHES_HEADING,
} from "@/app/(app)/search";

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FrappThemeProvider>
        <SearchScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The words inside one node. */
const textOf = (node: ReactTestInstance) =>
  node
    .findAll((child) => (child.type as unknown) === "Text")
    .map((child) => [child.props.children].flat().join(""))
    .join(" ");
const field = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "TextInput" &&
      node.props.placeholder === FIND_PLACEHOLDER,
  );
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
const chipLabels = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === "string" && node.props.accessibilityRole === "tab",
    )
    .map((node) => textOf(node));

beforeEach(() => {
  vi.clearAllMocks();
  state.ask = true;
  state.modules = {};
  state.lastResults = null;
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});

describe("Search screen (#5139)", () => {
  it("offers All and a chip per group, Events only with the module on", async () => {
    expect(chipLabels(await render())).toEqual([
      "All",
      "Channels",
      "Members",
      "Messages",
      "Events",
    ]);
    state.modules = { events: false };
    expect(chipLabels(await render())).not.toContain("Events");
  });

  it("narrows the list with a chip", async () => {
    const tree = await render();
    expect(state.lastResults?.filter).toBe("All");
    const members = tree.root.find(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "tab" &&
        textOf(node) === "Members",
    );
    act(() => members.props.onPress());
    expect(state.lastResults?.filter).toBe("Members");
  });

  it("ends in Ask Frapp about what was typed, which opens Ask with it in the field", async () => {
    const tree = await render();
    act(() => field(tree).props.onChangeText("rush week "));
    act(() => pressable(tree, askAboutLabel("rush week")).props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/ask",
      params: { draft: "rush week" },
    });
  });

  it("draws no Ask row for a member without Ask, or with nothing typed", async () => {
    let tree = await render();
    expect(tree.root.findAllByProps({ testID: "search-ask-row" })).toHaveLength(
      0,
    );
    state.ask = false;
    tree = await render();
    act(() => field(tree).props.onChangeText("rush"));
    expect(tree.root.findAllByProps({ testID: "search-ask-row" })).toHaveLength(
      0,
    );
  });

  it("keeps a search once a result is opened, and offers it again under an empty field", async () => {
    const tree = await render();
    act(() => field(tree).props.onChangeText("rush"));
    act(() =>
      state.lastResults!.onOpen({
        route: { pathname: "/event-details", params: { id: "e1" } },
      }),
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "frapp.search.recent.v1:u1:ch1",
      JSON.stringify(["rush"]),
    );
    expect(vi.mocked(useRouter)().push).toHaveBeenCalled();
    act(() => field(tree).props.onChangeText(""));
    expect(screenText(tree)).toContain(RECENT_SEARCHES_HEADING);
    act(() => pressable(tree, "rush").props.onPress());
    expect(field(tree).props.value).toBe("rush");
  });

  it("reads this member's recent searches for this chapter, and clears them", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify(["formal", "dues"]),
    );
    const tree = await render();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(
      "frapp.search.recent.v1:u1:ch1",
    );
    const text = screenText(tree);
    expect(text).toContain("formal");
    expect(text).toContain("dues");
    act(() => pressable(tree, "Clear recent searches").props.onPress());
    expect(
      tree.root.findAllByProps({ testID: "recent-searches" }),
    ).toHaveLength(0);
  });
});
