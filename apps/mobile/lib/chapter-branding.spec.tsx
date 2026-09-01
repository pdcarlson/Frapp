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
const BRAND_ON = signetDarkTokens.color.gold.onHouse;

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

// `accent-engine.md` §1 and `spec/ui/mobile/README.md` both forbid painting the
// raw seed: only generated scale steps may reach a screen. The served palette
// carries step 9 as `--signet-accent-primary`, so that is what the hook reads —
// the legacy per-surface resolver survives only for a chapter whose palette
// predates the Signet map.
describe("useChapterBranding accent source", () => {
  /** Step 11 of a generated scale — not equal to any seed we pass in. */
  const GENERATED_ACCENT_TEXT = "#FF907F";

  it("paints the generated step, not the chapter's raw seed", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          name: "Tau Nu",
          accent_color: CRIMSON,
          theme_palette: { "--signet-accent-text": GENERATED_ACCENT_TEXT },
        },
      },
      "chapter-1",
    );

    await waitFor(() => {
      expect(result.current.accent).toBe(GENERATED_ACCENT_TEXT);
    });
    expect(result.current.accent).not.toBe(CRIMSON);
  });

  it("reports no fallback on the engine path", async () => {
    // Generated steps are contrast-correct by construction (§8), so the runtime
    // substitution the legacy resolver performs has nothing to catch — claiming
    // otherwise would surface a "contrast adjusted" notice that is not true.
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          // A seed that WOULD fail the legacy dark-surface check.
          accent_color: CRIMSON,
          theme_palette: { "--signet-accent-text": GENERATED_ACCENT_TEXT },
        },
      },
      "chapter-1",
    );

    await waitFor(() => {
      expect(result.current.accent).toBe(GENERATED_ACCENT_TEXT);
    });
    expect(result.current.accentFallbackApplied).toBe(false);
  });

  it("falls back to the legacy resolver when the palette has no Signet map", async () => {
    // `--side-bg` is a sentinel, not a dependency: it stands for "a row exists
    // but predates the Signet map". Rows like this are exactly what the #920
    // slice-9 cutover left behind — it deleted the engine that wrote them
    // without migrating the stored jsonb, so this fallback is the reason that
    // was safe. Any non-Signet key would serve; this one is what real stale
    // rows actually hold.
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          accent_color: DARK_LEGIBLE_ACCENT,
          theme_palette: { "--side-bg": "#171512" },
        },
      },
      "chapter-1",
    );

    await waitFor(() => {
      expect(result.current.accent).toBe(DARK_LEGIBLE_ACCENT);
    });
  });

  it("still substitutes house gold on that legacy path when the seed fails AA", async () => {
    const { result } = renderBranding(
      { "chapter-1": { id: "chapter-1", accent_color: CRIMSON } },
      "chapter-1",
    );

    await waitFor(() => {
      expect(result.current.accent).toBe(BRAND);
    });
    expect(result.current.accentFallbackApplied).toBe(true);
  });
});

/**
 * The role choice is the whole safety argument, so pin the role *name* here and
 * let the engine's own suite prove the contrast property
 * (`packages/chapter-theme/src/signet.spec.ts`).
 *
 * The split is deliberate: `apps/mobile/package.json` is a frozen hotspot file
 * and declares neither `@repo/chapter-theme` nor `@repo/color`, so importing the
 * generator here would create an undeclared workspace dependency — the exact
 * trap `spec/ui/mobile/navigation.md` § Hotspot freeze calls out, because npm
 * hoisting makes it resolve anyway and breaks only under an isolated install.
 *
 * An earlier draft of this hook read `--signet-accent-primary` (step 9) and
 * justified it with §8's "contrast-correct by construction". §8 does not cover
 * step 9 — it is the solid *fill* role, and only the text roles are gated. On
 * the card surface a crimson chapter's step 9 measures 1.71:1.
 */
describe("the accent role this hook reads", () => {
  it("reads accent-text (step 11), never accent-primary (step 9)", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          accent_color: CRIMSON,
          theme_palette: {
            // Both present, so this asserts the choice rather than a fallback.
            "--signet-accent-primary": "#8B0000",
            "--signet-accent-text": "#FF907F",
          },
        },
      },
      "chapter-1",
    );

    await waitFor(() => {
      expect(result.current.accent).toBe("#FF907F");
    });
    expect(result.current.accent).not.toBe("#8B0000");
  });
});

// #1007: the chat self bubble is a solid fill, so it needs the step-9/on-primary
// pair `signet.ts` gates for exactly that pairing — never `accent` (step 11),
// which §8 does not hold to the fill contrast floor (see the suite above).
describe("useChapterBranding solid-fill pair (accentPrimary/accentOnPrimary)", () => {
  const GENERATED_ACCENT_TEXT = "#FF907F";
  const GENERATED_ACCENT_PRIMARY = "#8B0000";
  const GENERATED_ACCENT_ON_PRIMARY = "#FFFFFF";

  it("reads the generated primary/on-primary pair on the engine path", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          accent_color: CRIMSON,
          theme_palette: {
            "--signet-accent-text": GENERATED_ACCENT_TEXT,
            "--signet-accent-primary": GENERATED_ACCENT_PRIMARY,
            "--signet-accent-on-primary": GENERATED_ACCENT_ON_PRIMARY,
          },
        },
      },
      "chapter-1",
    );

    await waitFor(() =>
      expect(result.current.accentPrimary).toBe(GENERATED_ACCENT_PRIMARY),
    );
    expect(result.current.accentOnPrimary).toBe(GENERATED_ACCENT_ON_PRIMARY);
  });

  it("falls back to house gold on the legacy path (no Signet map)", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          accent_color: DARK_LEGIBLE_ACCENT,
          theme_palette: { "--side-bg": "#171512" },
        },
      },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.accentPrimary).toBe(BRAND));
    expect(result.current.accentOnPrimary).toBe(BRAND_ON);
  });

  it("falls back to house gold with no chapter resolved", async () => {
    const { result } = renderBranding({}, null);

    await waitFor(() => expect(result.current.accentPrimary).toBe(BRAND));
    expect(result.current.accentOnPrimary).toBe(BRAND_ON);
  });
});
