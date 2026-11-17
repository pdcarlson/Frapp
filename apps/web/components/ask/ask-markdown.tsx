"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  ASK_RENDER_ELEMENTS,
  askMarkers,
  askPreviewMarkdown,
  remarkAskAnswer,
  remarkAskLists,
  type AskMarker,
} from "@repo/chat-core/ask-markdown";
import type { AskCitation, AskEntity } from "@repo/validation";
import { MENTION_CHIP } from "@/components/chat/chip";
import {
  MessageMarkdown,
  type MessageMarkdownExtras,
} from "@/components/chat/renderers/message-markdown";
import { onPlainClick } from "@/components/ask/ask-entity-text";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { cn } from "@/lib/utils";

/**
 * An answer's words as markdown on web (#5429): bold, italic, code and lists
 * as chat draws a message (`MessageMarkdown`), with Ask's gold markers and the
 * people and channels the server named (`@repo/chat-core/ask-markdown` says
 * how the three are carried through the parse). The phone's twin is
 * `apps/mobile/components/ask/ask-markdown.tsx`.
 */

/** A property the parse set, as react-markdown hands it over. */
function propertyOf(props: object, name: string): string | null {
  const value = (props as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

/** What the parse adds for Ask: its pass, its lists, its two elements. */
function extrasFor({
  entities,
  markers,
  marker,
  canOpenChannel,
  onFollow,
}: {
  entities: readonly AskEntity[];
  markers: readonly AskMarker[];
  marker: (marker: AskMarker) => ReactNode;
  canOpenChannel: (channelId: string) => boolean;
  onFollow?: () => void;
}): MessageMarkdownExtras {
  return {
    remarkPlugins: [[remarkAskAnswer, { entities, markers }], remarkAskLists],
    allowedElements: ASK_RENDER_ELEMENTS,
    components: {
      sup: (props) => {
        const placed = markers[Number(propertyOf(props, "data-ask-marker"))];
        return placed ? <>{marker(placed)}</> : null;
      },
      span: ({ children, ...props }) => {
        const type = propertyOf(props, "data-ask-entity");
        const id = propertyOf(props, "data-ask-id");
        if (type === "member") {
          return <mark className={MENTION_CHIP}>{children}</mark>;
        }
        if (type === "channel" && id && canOpenChannel(id)) {
          return (
            <Link
              href={chatDeepLink({ channelId: id })}
              onClick={onPlainClick(onFollow)}
              className={cn(
                MENTION_CHIP,
                "underline-offset-2 hover:underline",
                FOCUS_RING_OFFSET,
              )}
            >
              {children}
            </Link>
          );
        }
        return <>{children}</>;
      },
    },
  };
}

export function AskMarkdown({
  text,
  citations,
  entities,
  marker,
  canOpenChannel = () => false,
  onFollow,
}: {
  /** The answer's words as the server wrote them, markdown included. */
  text: string;
  citations: readonly Omit<AskCitation, "quote">[];
  entities: readonly AskEntity[];
  /** Draws one marker: the gold number for its source. */
  marker: (marker: AskMarker) => ReactNode;
  canOpenChannel?: (channelId: string) => boolean;
  onFollow?: () => void;
}) {
  const markers = useMemo(
    () =>
      askMarkers({
        text,
        citations: citations.map((citation) => ({ ...citation, quote: "" })),
      }),
    [text, citations],
  );
  const extras = useMemo(
    () => extrasFor({ entities, markers, marker, canOpenChannel, onFollow }),
    [entities, markers, marker, canOpenChannel, onFollow],
  );
  return <MessageMarkdown content={text} extras={extras} />;
}

const PREVIEW_EXTRAS = extrasFor({
  entities: [],
  markers: [],
  marker: () => null,
  canOpenChannel: () => false,
});

/** A streaming preview: the same look; an unclosed `**` waits for its close. */
export function AskPreviewMarkdown({ text }: { text: string }) {
  return (
    <MessageMarkdown
      content={askPreviewMarkdown(text)}
      extras={PREVIEW_EXTRAS}
    />
  );
}
