/**
 * How each built-in chat background looks (#3973), as data both renderers
 * read: web turns it into CSS (`apps/web/components/chat/chat-background.tsx`)
 * and mobile into SVG (`apps/mobile/components/chat/chat-background.tsx`). The
 * values come from the chat concept page's backgrounds (Plain, Gold glow,
 * Midnight, Game day, Letters); the keys are `CHAT_BACKGROUND_BUILT_INS` in
 * `@repo/validation`.
 *
 * Every one is dark, because Signet is dark-only and the thread's text tokens
 * are tuned for `--background`. The AA guard
 * (`apps/web/components/chat/chat-background-contrast.spec.ts`) measures every
 * text token against every pixel colour a background can produce
 * (`chatBackgroundSamples`), so a new or brighter background fails there
 * rather than on a member's screen.
 */
import { mixHex } from "@repo/color";
import { signetDarkTokens } from "./signet";

export type ChatBackgroundBuiltInKey =
  "plain" | "gold-glow" | "midnight" | "game-day" | "letters";

export type ChatBackgroundLayer =
  /** A full-bleed gradient of opaque stops, at `angle` degrees (CSS convention). */
  | {
      kind: "linear";
      angle: number;
      stops: readonly { offset: number; color: string }[];
    }
  /**
   * A soft glow: `color` at `alpha` at the centre, fading to nothing at
   * `fade` of the radius. Centre and radii are fractions of the box.
   */
  | {
      kind: "radial";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      color: string;
      alpha: number;
      fade: number;
    }
  /** Horizontal bands of two alternating colours, each `height` px tall. */
  | { kind: "bands"; height: number; colors: readonly [string, string] }
  /** A thin rule every `every` px, `thickness` px tall. */
  | {
      kind: "rules";
      every: number;
      thickness: number;
      color: string;
      alpha: number;
    }
  /** The chapter's letters as a faint repeating tile. */
  | {
      kind: "letters";
      width: number;
      height: number;
      fontSize: number;
      color: string;
      alphas: readonly [number, number];
    };

export interface ChatBackgroundPaint {
  /** The colour under every layer. */
  base: string;
  layers: readonly ChatBackgroundLayer[];
}

const GOLD = "#DDB844";

export const CHAT_BACKGROUND_PAINTS: Record<
  ChatBackgroundBuiltInKey,
  ChatBackgroundPaint
> = {
  plain: { base: signetDarkTokens.color.surface.background, layers: [] },
  "gold-glow": {
    base: "#0B0A08",
    // The concept page's top glow was 0.20; where the two glows meet that put
    // `muted` text at 4.33:1, so it is 0.16 here (the AA guard measures it).
    layers: [
      {
        kind: "radial",
        cx: 0.85,
        cy: 0,
        rx: 1.2,
        ry: 0.7,
        color: GOLD,
        alpha: 0.16,
        fade: 0.6,
      },
      {
        kind: "radial",
        cx: 0,
        cy: 1,
        rx: 0.8,
        ry: 0.6,
        color: GOLD,
        alpha: 0.08,
        fade: 0.6,
      },
    ],
  },
  midnight: {
    base: "#07080C",
    layers: [
      {
        kind: "linear",
        angle: 170,
        stops: [
          { offset: 0, color: "#0F1730" },
          { offset: 0.45, color: "#0B0F1D" },
          { offset: 1, color: "#07080C" },
        ],
      },
    ],
  },
  "game-day": {
    base: "#0E1A10",
    layers: [
      { kind: "bands", height: 60, colors: ["#0E1A10", "#0C170E"] },
      {
        kind: "rules",
        every: 120,
        thickness: 2,
        color: "#FFFFFF",
        alpha: 0.07,
      },
    ],
  },
  letters: {
    base: "#0C0C0C",
    layers: [
      {
        kind: "letters",
        width: 150,
        height: 96,
        fontSize: 30,
        color: GOLD,
        alphas: [0.05, 0.035],
      },
    ],
  },
};

/**
 * A photo background sits under the thread's own `--background` at this
 * opacity, and blurred. The opacity is chosen for the worst pixel a photo can
 * hold, pure white, so every text token stays AA whatever was uploaded; the
 * guard proves it. It reads as a tint of the photo, which is the point: the
 * messages are the content (#3826).
 */
export const CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA = 0.88;
export const CHAT_BACKGROUND_PHOTO_BLUR_PX = 24;

/** `b` over `a` at `weightOfB`: what CSS composites. Shared with the AA guards. */
function mix(a: string, b: string, weightOfB: number): string {
  return mixHex(a, b, weightOfB);
}

/**
 * Every pixel colour a background can produce at its brightest, for the AA
 * guard. Glows are stacked at full strength (their peaks could overlap), and
 * a rule or a letter is laid over the brighter band.
 */
export function chatBackgroundSamples(key: ChatBackgroundBuiltInKey): string[] {
  const paint = CHAT_BACKGROUND_PAINTS[key];
  const samples = [paint.base];
  let glowPeak = paint.base;
  for (const layer of paint.layers) {
    switch (layer.kind) {
      case "linear":
        samples.push(...layer.stops.map((s) => s.color));
        break;
      case "radial":
        glowPeak = mix(glowPeak, layer.color, layer.alpha);
        samples.push(glowPeak);
        break;
      case "bands":
        samples.push(...layer.colors);
        break;
      case "rules":
        samples.push(...samples.map((s) => mix(s, layer.color, layer.alpha)));
        break;
      case "letters":
        samples.push(mix(paint.base, layer.color, Math.max(...layer.alphas)));
        break;
    }
  }
  return samples;
}

/** The brightest pixel a photo can produce once the scrim is over it. */
export function chatBackgroundPhotoWorstPixel(): string {
  return mix(
    "#FFFFFF",
    signetDarkTokens.color.surface.background,
    CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA,
  );
}
