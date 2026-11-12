"use client";

import type { MessageGif } from "@repo/chat-core/types";

/** A GIF's box in the thread: at most 300px wide or 200px tall. */
const GIF_MAX_WIDTH = 300;
const GIF_MAX_HEIGHT = 200;

/**
 * A GIF message's GIF (#4631): looping, silent, sized from its stored edges
 * before it loads so the thread never jumps, and a little smaller than a
 * photo, as Discord and Slack draw GIFs. Hotlinked from the provider's media
 * host, which the API checked on send.
 */
export function MessageGifImage({ gif }: { gif: MessageGif }) {
  const width = Math.round(
    Math.min(
      gif.width,
      GIF_MAX_WIDTH,
      (GIF_MAX_HEIGHT * gif.width) / gif.height,
    ),
  );
  return (
    <div className="mt-1" data-testid="message-gif">
      {/* eslint-disable-next-line @next/next/no-img-element -- an animated WebP from the GIF provider; next/image would re-encode it */}
      <img
        src={gif.url}
        alt={gif.title ? `GIF: ${gif.title}` : "GIF"}
        width={width}
        height={Math.round((width * gif.height) / gif.width)}
        loading="lazy"
        decoding="async"
        className="block h-auto max-w-full rounded-md bg-surface-1"
        style={{ aspectRatio: `${gif.width} / ${gif.height}`, width }}
      />
    </div>
  );
}
