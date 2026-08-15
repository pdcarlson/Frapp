/** @vitest-environment jsdom */
import React from "react";
import { Platform } from "react-native";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import {
  avatarRadius,
  fontFamilyFor,
  FrappThemeProvider,
  MONO_FONT_FAMILY,
  tint,
  typeRole,
  useFrappTheme,
} from "./theme";

describe("FrappThemeProvider", () => {
  it("serves the fixed Signet dark tokens", () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappThemeProvider>{children}</FrappThemeProvider>
    );
    Wrapper.displayName = "ThemeWrapper";

    const { result } = renderHook(() => useFrappTheme(), { wrapper: Wrapper });

    expect(result.current.tokens).toBe(signetDarkTokens);
  });

  it("throws outside the provider", () => {
    expect(() => renderHook(() => useFrappTheme())).toThrow(
      /within FrappThemeProvider/,
    );
  });
});

describe("typeRole", () => {
  it("produces a complete text style with the per-weight Figtree family", () => {
    expect(typeRole(signetDarkTokens.typography.role.body)).toEqual({
      fontSize: 16,
      fontFamily: "Figtree_400Regular",
      lineHeight: 25,
    });
  });

  it("omits lineHeight for roles that do not specify one", () => {
    expect(typeRole(signetDarkTokens.typography.role.label)).toEqual({
      fontSize: 14,
      fontFamily: "Figtree_600SemiBold",
    });
  });

  it("maps the bold roles to the bold family", () => {
    expect(typeRole(signetDarkTokens.typography.role.display).fontFamily).toBe(
      "Figtree_700Bold",
    );
  });

  it("never emits fontWeight — the per-weight family encodes it", () => {
    // A numeric weight next to an expo-font-registered family makes Android
    // resolve an unregistered BOLD variant and fall back to the system sans.
    for (const role of Object.values(signetDarkTokens.typography.role)) {
      expect(typeRole(role)).not.toHaveProperty("fontWeight");
    }
  });
});

describe("token helpers", () => {
  it("tint converts a semantic hex to the ~13% Signet fill by default", () => {
    expect(tint("#2F81F7")).toBe("rgba(47,129,247,0.13)");
  });

  it("tint accepts an explicit alpha for borders", () => {
    expect(tint("#F85149", 0.3)).toBe("rgba(248,81,73,0.3)");
  });

  it("avatarRadius halves the size (radius.avatar is a percent string)", () => {
    expect(avatarRadius(48)).toBe(24);
  });

  it("fontFamilyFor maps the three locked weights", () => {
    expect(fontFamilyFor(400)).toBe("Figtree_400Regular");
    expect(fontFamilyFor(600)).toBe("Figtree_600SemiBold");
    expect(fontFamilyFor(700)).toBe("Figtree_700Bold");
  });

  it("mono resolves to a native system stack, never a bundled font", () => {
    // Platform is mocked as iOS suite-wide.
    expect(MONO_FONT_FAMILY).toBe("Menlo");
  });

  it("mono falls back to the generic monospace stack off-iOS", () => {
    // No doMock/registry surgery (doUnmock would evict the suite-wide
    // react-native mock for the rest of this file): the suite mock's
    // Platform.select is a vi.fn, so the options object theme.tsx passed at
    // import time is recorded — assert the non-iOS branch from it directly.
    const monoCall = vi
      .mocked(Platform.select)
      .mock.calls.find(
        ([opts]) =>
          (opts as Record<string, unknown>).ios === "Menlo" &&
          "default" in (opts as Record<string, unknown>),
      );

    expect(monoCall).toBeDefined();
    expect((monoCall?.[0] as Record<string, unknown>).default).toBe(
      "monospace",
    );
  });
});
