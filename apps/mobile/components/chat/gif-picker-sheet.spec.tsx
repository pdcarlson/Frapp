/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/** The + sheet's GIF picker: its Search and Favorites tabs (#5772). */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const RESULT = {
  id: "g1",
  title: "wave",
  token: "signed",
  full: { url: "https://static.klipy.com/g1.webp", width: 200, height: 150 },
  preview: {
    url: "https://static.klipy.com/g1-s.webp",
    width: 100,
    height: 75,
  },
};

const state = vi.hoisted(() => ({
  favorites: [] as unknown[],
  mutate: vi.fn(),
}));
vi.mock("@repo/hooks", () => ({
  useGifSearch: () => ({
    results: [RESULT],
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
  useGifFavorites: () => ({
    favorites: state.favorites,
    isStarred: (id: string) =>
      state.favorites.some((gif) => (gif as { id: string }).id === id),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useToggleGifFavorite: () => ({ mutate: state.mutate }),
}));

import { GifPickerSheet } from "./gif-picker-sheet";

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <GifPickerSheet provider="KLIPY" onPick={vi.fn()} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const list = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetFlatList");

function draw(element: React.ReactElement) {
  let drawn!: ReactTestRenderer;
  act(() => {
    drawn = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return drawn;
}

const firstRow = (tree: ReactTestRenderer) =>
  draw(
    list(tree).props.renderItem({
      item: list(tree).props.data[0],
    }) as React.ReactElement,
  );

const starOf = (drawn: ReactTestRenderer) =>
  drawn.root.find(
    (node) =>
      typeof node.props.accessibilityLabel === "string" &&
      /favorites$/.test(node.props.accessibilityLabel) &&
      typeof node.props.onPress === "function",
  );

describe("GifPickerSheet favorites (#5772)", () => {
  it("stars a search result", () => {
    state.favorites = [];
    state.mutate.mockReset();
    const tree = render();
    const star = starOf(firstRow(tree));
    expect(star.props.accessibilityLabel).toBe("Add to favorites");
    act(() => star.props.onPress());
    expect(state.mutate).toHaveBeenCalledWith(
      { gif: RESULT, starred: true },
      expect.anything(),
    );
  });

  it("lists favorites under their own tab, with no search field", () => {
    state.favorites = [];
    const tree = render();
    const header = () => draw(list(tree).props.ListHeaderComponent);
    const tabs = header().root.find(
      (node) => node.props.accessibilityLabel === "GIFs" && node.props.onChange,
    );
    act(() => tabs.props.onChange("favorites"));
    expect(list(tree).props.data).toEqual([]);
    expect(screenText(draw(list(tree).props.ListEmptyComponent))).toContain(
      "No favorites yet",
    );
    expect(
      header().root.findAll(
        (node) => (node.type as unknown) === "BottomSheetTextInput",
      ),
    ).toHaveLength(0);

    state.favorites = [RESULT];
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <GifPickerSheet provider="KLIPY" onPick={vi.fn()} />
        </FrappThemeProvider>,
      ),
    );
    const star = starOf(firstRow(tree));
    expect(star.props.accessibilityLabel).toBe("Remove from favorites");
    expect(star.props.accessibilityState).toEqual({ selected: true });
  });
});
