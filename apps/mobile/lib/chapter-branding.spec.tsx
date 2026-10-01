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
/**
 * A seed light enough to clear AA on the dark card surface: the deleted
 * legacy resolver would have painted it as-is, so a test feeding it in tells
 * that resolver's return apart from the house-token fallthrough.
 */
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
  it("exposes the chapter mark's text through the shared precedence (#2876)", async () => {
    const { result } = renderBranding(
      {
        fiji: {
          name: "Tau Nu",
          branding: { greek_letters: "ΦΓΔ", short_name: "FIJI" },
        },
        optedOut: {
          name: "Tau Nu",
          branding: { greek_letters: "ΦΓΔ", show_greek_letters: false },
        },
        letters: { name: "California Eta", branding: { greek_letters: "ΣΦΕ" } },
      },
      "fiji",
    );
    await waitFor(() => expect(result.current.textMark).toBe("FIJI"));

    const optedOut = renderBranding(
      {
        optedOut: {
          name: "Tau Nu",
          branding: { greek_letters: "ΦΓΔ", show_greek_letters: false },
        },
      },
      "optedOut",
    );
    await waitFor(() =>
      expect(optedOut.result.current.chapterName).toBe("Tau Nu"),
    );
    // Stored letters, turned off: nothing, never ΦΓΔ.
    expect(optedOut.result.current.textMark).toBeNull();

    const letters = renderBranding(
      {
        letters: { name: "California Eta", branding: { greek_letters: "ΣΦΕ" } },
      },
      "letters",
    );
    await waitFor(() => expect(letters.result.current.textMark).toBe("ΣΦΕ"));
  });

  it("exposes the signed logo url, and null when no logo is set", async () => {
    const { result } = renderBranding(
      {
        "chapter-1": {
          name: "Tau Nu",
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

    const bare = renderBranding({ "chapter-2": { name: "Beta" } }, "chapter-2");
    await waitFor(() => expect(bare.result.current.chapterName).toBe("Beta"));
    expect(bare.result.current.logoUrl).toBeNull();
  });

  it("treats an empty name or logo url as unset", async () => {
    // The typed reads use `|| null`, not `??`: an empty string is no name and
    // no logo, so consumers take the text-branding fallback.
    const { result } = renderBranding(
      {
        "chapter-1": {
          name: "",
          logo_url: "",
          theme_palette: { "--signet-accent-text": DARK_LEGIBLE_ACCENT },
        },
      },
      "chapter-1",
    );

    await waitFor(() =>
      expect(result.current.accent).toBe(DARK_LEGIBLE_ACCENT),
    );
    expect(result.current.chapterName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });

  it("falls back to house gold with no chapter resolved", async () => {
    const { result } = renderBranding({}, null);

    await waitFor(() => expect(result.current.accent).toBe(BRAND));
    expect(result.current.chapterName).toBeNull();
    expect(result.current.logoUrl).toBeNull();
  });

  it("re-resolves branding when the active chapter changes", async () => {
    const { result, rerender, active } = renderBranding(
      {
        "chapter-1": {
          name: "Tau Nu",
          theme_palette: { "--signet-accent-text": "#FF907F" },
        },
        "chapter-2": {
          name: "Beta",
          theme_palette: { "--signet-accent-text": DARK_LEGIBLE_ACCENT },
          logo_url: "https://storage.example/signed/beta.png",
        },
      },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.chapterName).toBe("Tau Nu"));
    expect(result.current.accent).toBe("#FF907F");

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
// carries step 11 as `--signet-accent-text`, so that is what the hook reads (see
// "the accent role this hook reads" below), and a palette without it paints the
// house tokens rather than the seed.
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

  it("paints the house tokens, never the seed, when the palette has no Signet map", async () => {
    // `--side-bg` stands for "a row exists but has no Signet roles": the legacy
    // key real pre-#1147 rows held, and the state a row inserted without a
    // palette is in until the API's hourly sweep stamps it (#1165). The seed
    // clears AA on the dark card, so the deleted `resolveChapterAccentColor`
    // branch would have painted it (#2595); the house tokens must win instead.
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          name: "Tau Nu",
          accent_color: DARK_LEGIBLE_ACCENT,
          theme_palette: { "--side-bg": "#171512" },
        },
      },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.chapterName).toBe("Tau Nu"));
    expect(result.current.accent).toBe(BRAND);
    expect(result.current.accentPrimary).toBe(BRAND);
    expect(result.current.accentOnPrimary).toBe(BRAND_ON);
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
 * justified it with §8's "contrast-correct by construction". §8 holds step 9
 * only to the 3:1 fill floor, not to 4.5:1 as text: on `--card` a crimson
 * chapter's step 9 measures 4.23:1 (1.66:1 before #2541 lightened it, and
 * 3.32:1 before #2586 lightened it further).
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

// #1007: a solid accent fill (a poll's chosen option; the chat self bubble until
// #2873) needs the step-9/on-primary
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

  it("falls back to house gold with no chapter resolved", async () => {
    const { result } = renderBranding({}, null);

    await waitFor(() => expect(result.current.accentPrimary).toBe(BRAND));
    expect(result.current.accentOnPrimary).toBe(BRAND_ON);
  });

  it("falls back to house gold for both when only one of the pair is present", async () => {
    // A palette with `accentPrimary` but no `accentOnPrimary` (or vice versa)
    // is exactly the half-resolved case the both-or-neither gate exists to
    // catch — pairing a chapter's real fill with the house foreground (or
    // vice versa) would be the uncontrasted combination this hook prevents.
    const { result } = renderBranding(
      {
        "chapter-1": {
          id: "chapter-1",
          accent_color: DARK_LEGIBLE_ACCENT,
          theme_palette: {
            "--signet-accent-text": GENERATED_ACCENT_TEXT,
            "--signet-accent-primary": GENERATED_ACCENT_PRIMARY,
            // "--signet-accent-on-primary" deliberately absent.
          },
        },
      },
      "chapter-1",
    );

    await waitFor(() => expect(result.current.accentPrimary).toBe(BRAND));
    expect(result.current.accentOnPrimary).toBe(BRAND_ON);
  });
});
