import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GifPickerPanel } from "./gif-picker";

const RESULT = {
  id: "g1",
  title: "wave",
  token: "signed",
  full: { url: "https://static.klipy.com/g1.webp", width: 200, height: 150 },
  preview: { url: "https://static.klipy.com/g1-s.webp", width: 100, height: 75 },
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
    expect(tile.querySelector("img")).toHaveAttribute("src", RESULT.preview.url);
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
    expect(tile.querySelector("img")).toHaveAttribute("src", RESULT.preview.url);
    fireEvent.pointerLeave(tile);
    expect(tile.querySelector("img")).toBeNull();
    fireEvent.click(tile);
    expect(onPick).toHaveBeenCalledWith(RESULT);
  });
});
