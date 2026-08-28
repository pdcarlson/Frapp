/** @vitest-environment jsdom */
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  chapterId: null as string | null,
}));

vi.mock("./auth-session", () => ({
  useAuthSession: () => ({ chapterId: mockState.chapterId }),
}));

vi.mock("./auth-token", () => ({
  AUTH_TOKEN_STORAGE_KEY: "frapp.auth.token",
  readAuthToken: vi.fn(async () => null),
}));

vi.mock("./use-is-api-authenticated", () => ({
  useIsApiAuthenticated: () => false,
}));

vi.mock("@repo/api-sdk", () => ({
  createFrappClient: vi.fn(() => ({ __client: true })),
}));

vi.mock("@repo/hooks", () => ({
  FrappClientProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { FrappProvider } from "./frapp-client";
import { queryClient } from "./query-client";

/**
 * A cache entry that carries no chapter id in its key — the shape this fix
 * exists for. `["members", chapterId]` would re-key itself out of the leak;
 * these are the ones that cannot.
 */
const UNSCOPED_KEY = ["channels"];

function seedCache() {
  queryClient.setQueryData(UNSCOPED_KEY, ["outgoing-chapter-row"]);
}

function cachedRows() {
  return queryClient.getQueryData(UNSCOPED_KEY);
}

function renderAt(chapterId: string | null) {
  mockState.chapterId = chapterId;
  return render(
    <FrappProvider>
      <div />
    </FrappProvider>,
  );
}

beforeEach(() => {
  queryClient.clear();
  mockState.chapterId = null;
});

describe("FrappProvider — chapter-switch cache drop", () => {
  it("drops the cache when the active chapter changes", () => {
    const { rerender } = renderAt("chapter-a");
    seedCache();
    expect(cachedRows()).toEqual(["outgoing-chapter-row"]);

    mockState.chapterId = "chapter-b";
    rerender(
      <FrappProvider>
        <div />
      </FrappProvider>,
    );

    // The whole point: an unscoped key must not survive into the new chapter's
    // context, where it would render the outgoing chapter's rows.
    expect(cachedRows()).toBeUndefined();
  });

  it("does not drop the cache on first paint", () => {
    // Nothing chapter-scoped can be cached under a chapter yet, and clearing
    // here would only cancel in-flight bootstrap queries.
    renderAt("chapter-a");
    seedCache();
    expect(cachedRows()).toEqual(["outgoing-chapter-row"]);
  });

  it("does not drop the cache when the chapter id is unchanged", () => {
    // A token refresh re-reads the claim about once an hour and resolves the
    // same chapter. Clearing on that would empty the cache hourly for no reason.
    const { rerender } = renderAt("chapter-a");
    seedCache();

    rerender(
      <FrappProvider>
        <div />
      </FrappProvider>,
    );

    expect(cachedRows()).toEqual(["outgoing-chapter-row"]);
  });

  it("does not drop the cache when the first chapter resolves from null", () => {
    // `chapterId` is null until the `active_chapter_id` claim read settles, so
    // null -> chapter is a first resolution, not a switch. Treating it as one
    // would clear the bootstrap queries of every cold start.
    const { rerender } = renderAt(null);
    seedCache();

    mockState.chapterId = "chapter-a";
    rerender(
      <FrappProvider>
        <div />
      </FrappProvider>,
    );

    expect(cachedRows()).toEqual(["outgoing-chapter-row"]);
  });

  it("drops the cache when the chapter falls away to null", () => {
    // A magic-link account swap re-keys the claim store, so `chapterId` derives
    // to null on the same render as the new session. The outgoing chapter's rows
    // must not outlive it.
    const { rerender } = renderAt("chapter-a");
    seedCache();

    mockState.chapterId = null;
    rerender(
      <FrappProvider>
        <div />
      </FrappProvider>,
    );

    expect(cachedRows()).toBeUndefined();
  });
});
