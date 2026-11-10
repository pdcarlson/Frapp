import { describe, expect, it } from "vitest";
import {
  CHAT_BACKGROUND_PAINTS,
  chatBackgroundPhotoWorstPixel,
  chatBackgroundSamples,
  type ChatBackgroundBuiltInKey,
} from "@repo/theme/chat-backgrounds";
import {
  AA_TEXT,
  DESTRUCTIVE_TEXT,
  SEEDS,
  TEXT,
  accentRolesFor,
  ratio,
} from "@/tests/signet-contrast";

/**
 * Chat backgrounds (#3973) keep every thread text token AA. Measured against
 * every pixel colour a built-in can produce at its brightest, and against the
 * brightest pixel a photo can produce under its scrim (a pure white pixel),
 * so no upload can push the thread below AA. Paul's P1 #3826 is about dim
 * text, so this guards the same failure. The accent text varies by chapter,
 * so it is measured against every seeded chapter colour.
 */
const TEXT_TOKENS = {
  foreground: TEXT.foreground,
  mutedForeground: TEXT.mutedForeground,
  muted: TEXT.muted,
  destructiveText: DESTRUCTIVE_TEXT,
};

function assertAllTextAA(pixel: string, label: string) {
  for (const [name, color] of Object.entries(TEXT_TOKENS)) {
    expect(ratio(color, pixel), `${name} on ${label}`).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  }
  for (const seed of SEEDS) {
    const accent = accentRolesFor(seed)["--accent-text"]!;
    expect(
      ratio(accent, pixel),
      `accent text (${seed}) on ${label}`,
    ).toBeGreaterThanOrEqual(AA_TEXT);
  }
}

describe("chat backgrounds keep thread text AA", () => {
  for (const key of Object.keys(
    CHAT_BACKGROUND_PAINTS,
  ) as ChatBackgroundBuiltInKey[]) {
    it(`on the ${key} built-in`, () => {
      for (const pixel of chatBackgroundSamples(key)) {
        assertAllTextAA(pixel, `${key} ${pixel}`);
      }
    });
  }

  it("on a photo under its scrim, at a pure white pixel", () => {
    assertAllTextAA(chatBackgroundPhotoWorstPixel(), "photo scrim");
  });
});
