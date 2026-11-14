"use client";

import { useEffect, useRef, useState } from "react";
import { gifBoxSize, type MessageGif } from "@repo/chat-core/types";
import { FOCUS_RING } from "@/components/ui/focus";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

/** A GIF's box in the thread: at most 300px wide or 200px tall. */
const GIF_MAX = { width: 300, height: 200 };

const IMAGE_CLASS = "block h-auto max-w-full rounded-md bg-surface-1";

/**
 * A GIF message's GIF (#4631): looping, silent, sized from its stored edges
 * before it loads so the thread never jumps, and a little smaller than a
 * photo, as Discord and Slack draw GIFs. Hotlinked from the provider's media
 * host, which the API checked on send.
 *
 * For a member whose system asks for reduced motion (#4657) it holds its
 * first frame with a "GIF" badge and plays while hovered or focused, as
 * Slack and Discord do for reduced motion. The still is drawn from the same
 * image, so no second rendition is stored or fetched.
 */
export function MessageGifImage({ gif }: { gif: MessageGif }) {
  const reduceMotion = usePrefersReducedMotion();
  const { width, height } = gifBoxSize(gif, GIF_MAX);
  const alt = gif.title ? `GIF: ${gif.title}` : "GIF";
  const style = { aspectRatio: `${gif.width} / ${gif.height}`, width };

  if (!reduceMotion) {
    return (
      <div className="mt-1" data-testid="message-gif">
        {/* eslint-disable-next-line @next/next/no-img-element -- an animated WebP from the GIF provider; next/image would re-encode it */}
        <img
          src={gif.url}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className={IMAGE_CLASS}
          style={style}
        />
      </div>
    );
  }
  return (
    <StillGif
      gif={gif}
      alt={alt}
      width={width}
      height={height}
      style={style}
    />
  );
}

function StillGif({
  gif,
  alt,
  width,
  height,
  style,
}: {
  gif: MessageGif;
  alt: string;
  width: number;
  height: number;
  style: { aspectRatio: string; width: number };
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const playing = hovered || focused;
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // The first frame, painted once the image loads. A cross-origin image
  // taints the canvas, which only stops reading its pixels back; drawing it
  // is allowed.
  useEffect(() => {
    const image = new Image();
    let live = true;
    image.onload = () => {
      const target = canvas.current;
      if (!live || !target) return;
      target.getContext("2d")?.drawImage(image, 0, 0, width, height);
    };
    image.src = gif.url;
    return () => {
      live = false;
      image.onload = null;
    };
  }, [gif.url, width, height]);

  return (
    <div className="mt-1" data-testid="message-gif">
      <button
        type="button"
        aria-label={alt}
        aria-description="Plays while hovered or focused"
        className={cn("relative block max-w-full rounded-md", FOCUS_RING)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {/* Always mounted, so the still survives a hover. */}
        <canvas
          ref={canvas}
          data-testid="message-gif-still"
          width={width}
          height={height}
          aria-hidden="true"
          className={IMAGE_CLASS}
          style={style}
        />
        {playing ? (
          /* eslint-disable-next-line @next/next/no-img-element -- an animated WebP from the GIF provider; next/image would re-encode it */
          <img
            src={gif.url}
            alt=""
            width={width}
            height={height}
            decoding="async"
            className={cn(IMAGE_CLASS, "absolute inset-0 h-full w-full")}
          />
        ) : null}
        {playing ? null : (
          <span
            aria-hidden="true"
            className="absolute bottom-1.5 left-1.5 rounded-[5px] border border-border bg-popover px-1 text-caption font-bold text-foreground"
          >
            GIF
          </span>
        )}
      </button>
    </div>
  );
}
