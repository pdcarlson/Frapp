"use client";

import { useMemo, type CSSProperties } from "react";
import { parseHex } from "@repo/color";
import { useChatBackground, useCurrentChapter } from "@repo/hooks";
import {
  CHAT_BACKGROUND_PAINTS,
  CHAT_BACKGROUND_PHOTO_BLUR_PX,
  CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA,
  type ChatBackgroundBuiltInKey,
  type ChatBackgroundLayer,
} from "@repo/theme/chat-backgrounds";
import { chapterMarkFor } from "@/components/layout/crest-tile";
import { useChapterStore } from "@/lib/stores/chapter-store";

/**
 * What sits behind a channel's messages (#3973): its own background, else the
 * chapter default, else plain. Drawn from `@repo/theme/chat-backgrounds` so web
 * and mobile can't drift; every built-in and the photo scrim are measured AA
 * against the thread's text tokens in `chat-background-contrast.spec.ts`.
 *
 * Fills its positioned parent and sits behind it (`-z-10` in an `isolate`
 * parent), so the thread itself needs no change. Until the read resolves, and
 * on any failure, it draws plain: a background is decoration and never holds
 * up the thread.
 */
export function ChatBackground({ channelId }: { channelId: string | null }) {
  const { data } = useChatBackground(channelId);
  const letters = useChapterLetters();

  // An unknown key (a newer API than this bundle) draws plain, never throws.
  const stored = data?.background ?? "plain";
  const key =
    stored === "photo" || stored in CHAT_BACKGROUND_PAINTS ? stored : "plain";
  if (key === "photo") {
    if (!data?.photo_url) return <Layer style={paintStyle("plain", letters)} />;
    return (
      <div
        aria-hidden="true"
        data-chat-background="photo"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background"
      >
        {/* Overscanned so the blur's soft edge never shows at the column's sides. */}
        <div
          className="absolute -inset-12 bg-cover bg-center"
          style={{
            backgroundImage: `url("${data.photo_url}")`,
            filter: `blur(${CHAT_BACKGROUND_PHOTO_BLUR_PX}px)`,
          }}
        />
        <div
          className="absolute inset-0 bg-background"
          style={{ opacity: CHAT_BACKGROUND_PHOTO_SCRIM_ALPHA }}
        />
      </div>
    );
  }
  return <Layer style={paintStyle(key, letters)} keyName={key} />;
}

/** The chapter's mark (letters, else initials), for the Letters background. */
export function useChapterLetters(): string {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data: chapter } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: !!activeChapterId,
  });
  return useMemo(
    () => (chapter ? chapterMarkFor(chapter).text : ""),
    [chapter],
  );
}

function Layer({
  style,
  keyName = "plain",
}: {
  style: CSSProperties;
  keyName?: string;
}) {
  return (
    <div
      aria-hidden="true"
      data-chat-background={keyName}
      className="pointer-events-none absolute inset-0 -z-10"
      style={style}
    />
  );
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex) ?? { r: 0, g: 0, b: 0 };
  return `rgba(${r},${g},${b},${alpha})`;
}

function lettersTile(
  layer: Extract<ChatBackgroundLayer, { kind: "letters" }>,
  letters: string,
): string {
  const safe = letters.replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layer.width}" height="${layer.height}">` +
    `<text x="10" y="40" font-family="Georgia,serif" font-size="${layer.fontSize}" fill="${layer.color}" fill-opacity="${layer.alphas[0]}" letter-spacing="2">${safe}</text>` +
    `<text x="85" y="88" font-family="Georgia,serif" font-size="${layer.fontSize}" fill="${layer.color}" fill-opacity="${layer.alphas[1]}" letter-spacing="2">${safe}</text>` +
    `</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** The paint as CSS. CSS stacks the first image on top, so the layers go in reversed. */
export function paintStyle(
  key: ChatBackgroundBuiltInKey,
  letters: string,
): CSSProperties {
  const paint = CHAT_BACKGROUND_PAINTS[key];
  const images: string[] = [];
  const sizes: string[] = [];
  for (const layer of paint.layers) {
    switch (layer.kind) {
      case "linear":
        images.push(
          `linear-gradient(${layer.angle}deg, ${layer.stops
            .map((s) => `${s.color} ${s.offset * 100}%`)
            .join(", ")})`,
        );
        sizes.push("auto");
        break;
      case "radial":
        images.push(
          `radial-gradient(${layer.rx * 100}% ${layer.ry * 100}% at ${layer.cx * 100}% ${layer.cy * 100}%, ${rgba(layer.color, layer.alpha)}, transparent ${layer.fade * 100}%)`,
        );
        sizes.push("auto");
        break;
      case "bands":
        images.push(
          `repeating-linear-gradient(0deg, ${layer.colors[0]} 0 ${layer.height}px, ${layer.colors[1]} ${layer.height}px ${layer.height * 2}px)`,
        );
        sizes.push("auto");
        break;
      case "rules": {
        const gap = layer.every - layer.thickness;
        images.push(
          `repeating-linear-gradient(0deg, transparent 0 ${gap}px, ${rgba(layer.color, layer.alpha)} ${gap}px ${layer.every}px)`,
        );
        sizes.push("auto");
        break;
      }
      case "letters":
        if (!letters) break;
        images.push(lettersTile(layer, letters));
        sizes.push(`${layer.width}px ${layer.height}px`);
        break;
    }
  }
  return {
    backgroundColor: paint.base,
    backgroundImage: images.length ? images.reverse().join(", ") : undefined,
    backgroundSize: sizes.length ? sizes.reverse().join(", ") : undefined,
  };
}
