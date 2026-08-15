/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { signetDarkTokens } from "@repo/theme/signet";

// The real provider is a thin wrapper around the fixed Signet tokens; standing
// it in keeps this suite about accent resolution, not provider wiring.
vi.mock("./theme", () => ({
  useFrappTheme: () => ({
    tokens: signetDarkTokens,
  }),
}));

import { useChapterBranding } from "./chapter-branding";

/** The crimson `spec/behavior/branding.md` uses as its worked example. */
const CRIMSON = "#8B0000";
/** An accent light enough to clear AA on the dark card surface. */
const DARK_LEGIBLE_ACCENT = "#7FD1AE";
const BRAND = signetDarkTokens.color.gold.house;

type ChapterPayload = Record<string, unknown> | null;

function renderBranding(
  chaptersById: Record<string, ChapterPayload>,
  initialChapterId: string | null,
) {
  const active = { chapterId: initialChapterId };

  const client = {
    GET: vi.fn(async (path: string) => {
      if (path !== "/v1/chapters/current") return { data: null, error: null };
      return {
        data: active.chapterId ? chaptersById[active.chapterId] : null,
        error: null,
      };
    }),
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={client as unknown as ReturnType<typeof createFrappClient>}
      chapterId={active.chapterId}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );
  Wrapper.displayName = "ChapterBrandingWrapper";

  const view = renderHook(() => useChapterBranding(), { wrapper: Wrapper });
  return { ...view, active };
}

describe("useChapterBranding", () => {
  it("uses a chapter accent that is legible on the dark card surface", async () => {
    const { result } = renderBranding(
      { "chapter-1": { name: "Tau Nu", accent_color: DARK_LEGIBLE_ACCENT } },
      "chapter-1",
    );

    await waitFor(() =>
      expect(result.current.accent).toBe(DARK_LEGIBLE_ACCENT),
    );
    expect(result.current.accentFallbackApplied).toBe(false);
    expect(result.current.chapterName).toBe("Tau Nu");
  });

  it("substitutes house gold when the accent fails on the dark surface", async () => {
    // Crimson clears AA on white, so the API's light-mode gate stores it
    // happily — on the dark card it is unreadable and must not be painted.
    const { result } = renderBranding(
      { "chapter-1": { name: "Tau Nu", accent_color: CRIMSON } },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.chapterName).toBe("Tau Nu"));
    expect(result.current.accent).toBe(BRAND);
    expect(result.current.accentFallbackApplied).toBe(true);
  });

  it("exposes the signed logo url, and null when no logo is set", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          name: "Tau Nu",
          accent_color: DARK_LEGIBLE_ACCENT,
          logo_url: "https://storage.example/signed/logo.png",
        },
      },
      "chapter-1",
    );

    await waitFor(() =>
      expect(result.current.logoUrl).toBe(
        "https://storage.example/signed/logo.png",
      ),
    );

    const bare = renderBranding(
      { "chapter-2": { name: "Beta", accent_color: DARK_LEGIBLE_ACCENT } },
      "chapter-2",
    );
    await waitFor(() => expect(bare.result.current.chapterName).toBe("Beta"));
    expect(bare.result.current.logoUrl).toBeNull();
  });

  it("falls back to house gold with no chapter resolved", async () => {
    const { result } = renderBranding({}, null);

    await waitFor(() => expect(result.current.accent).toBe(BRAND));
    expect(result.current.accentFallbackApplied).toBe(true);
    expect(result.current.chapterName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });

  it("re-resolves branding when the active chapter changes", async () => {
    const { result, rerender, active } = renderBranding(
      {
        "chapter-1": { name: "Tau Nu", accent_color: CRIMSON },
        "chapter-2": {
          name: "Beta",
          accent_color: DARK_LEGIBLE_ACCENT,
          logo_url: "https://storage.example/signed/beta.png",
        },
      },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.chapterName).toBe("Tau Nu"));

    active.chapterId = "chapter-2";
    rerender();

    // No remount and no restart: the query key carries the chapter id, so the
    // switch alone re-resolves accent and logo (AC: "without app restart").
    await waitFor(() => expect(result.current.chapterName).toBe("Beta"));
    expect(result.current.accent).toBe(DARK_LEGIBLE_ACCENT);
    expect(result.current.logoUrl).toBe(
      "https://storage.example/signed/beta.png",
    );
  });
});
