"use client";

import { EMOJI_GROUPS, NEWER_EMOJI } from "@repo/chat-core/emoji-data";
import { emojiKey } from "@repo/chat-core/emoji-recent";

/**
 * The catalog's emoji this browser can't draw, by `emojiKey`, for the picker
 * to leave out: a reaction that shows as an empty box, or as the letters "US",
 * is worse than one missing from the picker.
 *
 * Two gaps are real on the machines members use. Windows draws no country
 * flags in any browser (Segoe UI Emoji has none), so the Flags group would be
 * letter pairs. And an older system font stops before Emoji 14 (Windows 10's
 * does), so the newest emoji would be boxes. `frimousse`, the library this
 * picker replaced, ran the same check before showing its data.
 *
 * The check draws one sample per gap on a small canvas: a drawn emoji has
 * colour where a box or a letter is flat ink, and a ZWJ sequence the font
 * doesn't know draws as its parts side by side, so twice as wide. Imported
 * only by the picker panel, so its catalog import stays in that lazy chunk.
 * Read once per page; a browser without a 2D canvas hides nothing.
 */

const SIZE = 32;
const FONT = `${SIZE - 8}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** One sample per catalog version from 13 on: one emoji its font must know. */
const VERSION_SAMPLES: Record<number, string> = {
  13: "\u{1F972}", // smiling face with tear
  13.1: "\u{1F636}\u200D\u{1F32B}\uFE0F", // face in clouds
  14: "\u{1FAE0}", // melting face
};
const FLAG_SAMPLE = "\u{1F1FA}\u{1F1F8}"; // flag: United States
const BASELINE = "\u{1F600}"; // grinning face, Emoji 1.0

function drawable(ctx: CanvasRenderingContext2D, emoji: string): boolean {
  const wide = ctx.measureText(emoji).width;
  const one = ctx.measureText(BASELINE).width;
  if (one > 0 && wide > one * 1.5) return false;
  ctx.clearRect(0, 0, SIZE * 2, SIZE);
  ctx.fillText(emoji, 0, 0);
  const { data } = ctx.getImageData(0, 0, SIZE * 2, SIZE);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 16) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 48) return true;
  }
  return false;
}

let hidden: ReadonlySet<string> | null = null;

export function undrawableEmoji(): ReadonlySet<string> {
  if (hidden) return hidden;
  const out = new Set<string>();
  hidden = out;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * 2;
    canvas.height = SIZE;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    ctx = null;
  }
  if (!ctx) return out;
  ctx.font = FONT;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000";
  // The baseline itself must draw in colour, or the check can't tell anything.
  if (!drawable(ctx, BASELINE)) return out;

  let firstMissing: number | null = null;
  for (const version of Object.keys(VERSION_SAMPLES)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (!drawable(ctx, VERSION_SAMPLES[version]!)) {
      firstMissing = version;
      break;
    }
  }
  if (firstMissing !== null) {
    for (const { version, emojis } of NEWER_EMOJI) {
      if (version < firstMissing) continue;
      for (const emoji of emojis) out.add(emojiKey(emoji));
    }
  }
  if (!drawable(ctx, FLAG_SAMPLE)) {
    const flags = EMOJI_GROUPS.find((group) => group.name === "Flags");
    for (const entry of flags?.entries ?? []) {
      const emoji = entry.slice(0, entry.indexOf("|"));
      // Only the country flags are letter pairs; the chequered, white, rainbow
      // and pirate flags are ordinary pictographs every emoji font draws.
      if (/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(emoji)) out.add(emojiKey(emoji));
    }
  }
  return out;
}
