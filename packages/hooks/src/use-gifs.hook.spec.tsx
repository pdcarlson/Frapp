import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createHookWrapper } from "./test-utils";
import {
  useGifFavorites,
  useToggleGifFavorite,
  type GifResult,
} from "./use-gifs";

const gif = (id: string): GifResult => ({
  id,
  title: id,
  preview: {
    url: `https://static.klipy.com/${id}.webp`,
    width: 200,
    height: 150,
  },
  full: { url: `https://static.klipy.com/${id}.gif`, width: 200, height: 150 },
  token: `token-${id}`,
});

const ok = (data?: unknown) => ({
  data,
  response: { ok: true, status: data === undefined ? 204 : 200 },
});
const refused = {
  error: {
    message: "You can keep up to 200 favorite GIFs. Remove one to add another.",
  },
  response: { ok: false, status: 400 },
};

function both() {
  return { favorites: useGifFavorites(), toggle: useToggleGifFavorite() };
}

describe("GIF favorites (#5772)", () => {
  it("turns the star at once, before the server answers", async () => {
    let answer!: (value: unknown) => void;
    const client = {
      GET: vi.fn().mockResolvedValue(ok({ results: [gif("wave")] })),
      POST: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    };
    const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });
    const { result } = renderHook(both, { wrapper });
    await waitFor(() =>
      expect(result.current.favorites.isStarred("wave")).toBe(true),
    );

    act(() =>
      result.current.toggle.mutate({ gif: gif("dance"), starred: true }),
    );

    await waitFor(() =>
      expect(result.current.favorites.isStarred("dance")).toBe(true),
    );
    expect(result.current.favorites.favorites.map((g) => g.id)).toEqual([
      "dance",
      "wave",
    ]);
    await act(async () => answer(ok()));
  });

  it("turns the star back with the server's reason when it refuses", async () => {
    const client = {
      GET: vi.fn().mockResolvedValue(ok({ results: [gif("wave")] })),
      POST: vi.fn().mockResolvedValue(refused),
    };
    const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });
    const { result } = renderHook(both, { wrapper });
    await waitFor(() =>
      expect(result.current.favorites.isStarred("wave")).toBe(true),
    );

    const onError = vi.fn();
    act(() =>
      result.current.toggle.mutate(
        { gif: gif("dance"), starred: true },
        { onError },
      ),
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0].message).toMatch(
      /up to 200 favorite GIFs/,
    );
    expect(result.current.favorites.isStarred("dance")).toBe(false);
    expect(result.current.favorites.isStarred("wave")).toBe(true);
  });

  it("sends a quick star then unstar in that order", async () => {
    const calls: string[] = [];
    let answerPost!: (value: unknown) => void;
    const client = {
      GET: vi.fn().mockResolvedValue(ok({ results: [] })),
      POST: vi.fn(() => {
        calls.push("star");
        return new Promise((resolve) => (answerPost = resolve));
      }),
      DELETE: vi.fn(() => {
        calls.push("unstar");
        return Promise.resolve(ok());
      }),
    };
    const wrapper = createHookWrapper({ client, chapterId: "chapter-1" });
    const { result } = renderHook(both, { wrapper });
    await waitFor(() => expect(client.GET).toHaveBeenCalled());

    act(() =>
      result.current.toggle.mutate({ gif: gif("dance"), starred: true }),
    );
    act(() =>
      result.current.toggle.mutate({ gif: gif("dance"), starred: false }),
    );
    await waitFor(() => expect(calls).toEqual(["star"]));

    await act(async () => answerPost(ok()));
    await waitFor(() => expect(calls).toEqual(["star", "unstar"]));
  });
});
