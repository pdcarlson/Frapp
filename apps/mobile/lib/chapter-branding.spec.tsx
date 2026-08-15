/** @vitest-environment jsdom */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { createFrappClient } from "@repo/api-sdk";
import { FrappClientProvider } from "@repo/hooks";
import { frappDarkTokens, frappLightTokens } from "@repo/theme/tokens";

const themeState = vi.hoisted(() => ({ mode: "light" as "light" | "dark" }));

// The real provider hydrates from AsyncStorage and reads useColorScheme, which
// the suite-wide react-native mock does not supply. Branding only consumes the
// resolved tokens, so standing them in keeps this about accent resolution.
vi.mock("./theme", () => ({
  useFrappTheme: () => ({
    tokens: themeState.mode === "dark" ? frappDarkTokens : frappLightTokens,
    resolvedTheme: themeState.mode,
    themePreference: "system",
    setThemePreference: vi.fn(),
  }),
}));

import { useChapterBranding } from "./chapter-branding";

/** The crimson `spec/behavior/branding.md` uses as its worked example. */
const CRIMSON = "#8B0000";
const LIGHT_BRAND = frappLightTokens.color.brand.bronze;
const DARK_BRAND = frappDarkTokens.color.brand.bronze;

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
  it("uses a chapter accent that is legible on the light surface", async () => {
    themeState.mode = "light";
    const { result } = renderBranding(
      { "chapter-1": { name: "Tau Nu", accent_color: CRIMSON } },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.accent).toBe(CRIMSON));
    expect(result.current.accentFallbackApplied).toBe(false);
    expect(result.current.chapterName).toBe("Tau Nu");
  });

  it("substitutes the dark brand token when the accent fails on dark", async () => {
    // Crimson clears AA on white, so the API's light-mode gate stores it
    // happily — on the dark card it is unreadable and must not be painted.
    themeState.mode = "dark";
    const { result } = renderBranding(
      { "chapter-1": { name: "Tau Nu", accent_color: CRIMSON } },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.chapterName).toBe("Tau Nu"));
    expect(result.current.accent).toBe(DARK_BRAND);
    expect(result.current.accentFallbackApplied).toBe(true);
  });

  it("exposes the signed logo url, and null when no logo is set", async () => {
    themeState.mode = "light";
    const { result } = renderBranding(
      {
        "chapter-1": {
          name: "Tau Nu",
          accent_color: CRIMSON,
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
      { "chapter-2": { name: "Beta", accent_color: CRIMSON } },
      "chapter-2",
    );
    await waitFor(() => expect(bare.result.current.chapterName).toBe("Beta"));
    expect(bare.result.current.logoUrl).toBeNull();
  });

  it("falls back to the brand token with no chapter resolved", async () => {
    themeState.mode = "light";
    const { result } = renderBranding({}, null);

    await waitFor(() => expect(result.current.accent).toBe(LIGHT_BRAND));
    expect(result.current.accentFallbackApplied).toBe(true);
    expect(result.current.chapterName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });

  it("re-resolves branding when the active chapter changes", async () => {
    themeState.mode = "light";
    const { result, rerender, active } = renderBranding(
      {
        "chapter-1": { name: "Tau Nu", accent_color: CRIMSON },
        "chapter-2": {
          name: "Beta",
          accent_color: "#1B4D3E",
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
    expect(result.current.accent).toBe("#1B4D3E");
    expect(result.current.logoUrl).toBe(
      "https://storage.example/signed/beta.png",
    );
  });
});
