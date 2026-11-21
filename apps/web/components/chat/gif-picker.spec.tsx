import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GifPickerPanel } from "./gif-picker";

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

const favoritesState = vi.hoisted(() => ({
  favorites: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useGifFavorites: () => ({
    favorites: favoritesState.favorites,
    isStarred: (id: string) =>
      favoritesState.favorites.some((gif) => (gif as { id: string }).id === id),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useToggleGifFavorite: () => ({ mutate: favoritesState.mutate }),
  useGifSearch: () => ({
    results: [RESULT],
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: vi.fn(),
  }),
}));

// jsdom has no scrolling; the panel scrolls to the top on a new search.
Element.prototype.scrollTo = function scrollTo() {};

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GifPickerPanel reduced motion (#4657)", () => {
  it("plays results for a member with no motion preference", () => {
    mockReducedMotion(false);
    render(<GifPickerPanel provider="KLIPY" onPick={vi.fn()} />);
    const tile = screen.getByRole("button", { name: "Send GIF: wave" });
    expect(tile.querySelector("img")).toHaveAttribute(
      "src",
      RESULT.preview.url,
    );
    expect(screen.queryByTestId("message-gif-still")).toBeNull();
  });

  it("holds each result still with reduced motion, playing it while hovered, and still sends on click", () => {
    mockReducedMotion(true);
    const onPick = vi.fn();
    render(<GifPickerPanel provider="KLIPY" onPick={onPick} />);
    const tile = screen.getByRole("button", { name: "Send GIF: wave" });
    expect(screen.getByTestId("message-gif-still")).toBeInTheDocument();
    expect(tile.querySelector("img")).toBeNull();
    fireEvent.pointerEnter(tile);
    expect(tile.querySelector("img")).toHaveAttribute(
      "src",
      RESULT.preview.url,
    );
    fireEvent.pointerLeave(tile);
    expect(tile.querySelector("img")).toBeNull();
    fireEvent.click(tile);
    expect(onPick).toHaveBeenCalledWith(RESULT);
  });
});

describe("GifPickerPanel favorites (#5772)", () => {
  it("stars a result, and lists favorites under their own tab", () => {
    mockReducedMotion(false);
    favoritesState.favorites = [];
    favoritesState.mutate.mockReset();
    const { rerender } = render(
      <GifPickerPanel provider="KLIPY" onPick={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    expect(favoritesState.mutate).toHaveBeenCalledWith(
      { gif: RESULT, starred: true },
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Favorites" }));
    expect(screen.getByText("No favorites yet")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();

    favoritesState.favorites = [RESULT];
    rerender(<GifPickerPanel provider="KLIPY" onPick={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Remove from favorites" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove from favorites" }),
    );
    expect(favoritesState.mutate).toHaveBeenLastCalledWith(
      { gif: RESULT, starred: false },
      expect.anything(),
    );
  });
});
