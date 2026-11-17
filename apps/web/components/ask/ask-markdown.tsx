"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { Components } from "react-markdown";
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
 * how the three are carried through the parse, and why a link is drawn as
 * its words). The phone's twin is `apps/mobile/components/ask/ask-markdown.tsx`.
 *
 * **Parsed once per answer.** Every turn re-renders while another streams, so
 * what the parse depends on (the text, its markers, the listed names) is the
 * memo's key, and what only drawing needs (how a marker draws, which
 * channels open) reaches the two components through context. The components
 * are this module's own, so React never sees a new element type.
 */

interface AskMarkdownContextValue {
  markers: readonly AskMarker[];
  marker: (marker: AskMarker) => ReactNode;
  canOpenChannel: (channelId: string) => boolean;
  onFollow?: () => void;
}

const AskMarkdownContext = createContext<AskMarkdownContextValue | null>(null);

/** A property the parse set, as react-markdown hands it over. */
function propertyOf(props: object, name: string): string | null {
  const value = (props as Record<string, unknown>)[name];
  return typeof value === "string" ? value : null;
}

function Marker(props: object) {
  const context = useContext(AskMarkdownContext);
  const placed = context?.markers[Number(propertyOf(props, "data-ask-marker"))];
  return context && placed ? <>{context.marker(placed)}</> : null;
}

function Entity({ children, ...props }: { children?: ReactNode } & object) {
  const context = useContext(AskMarkdownContext);
  const type = propertyOf(props, "data-ask-entity");
  const id = propertyOf(props, "data-ask-id");
  if (type === "member") {
    return <mark className={MENTION_CHIP}>{children}</mark>;
  }
  if (type === "channel" && id && context?.canOpenChannel(id)) {
    return (
      <Link
        href={chatDeepLink({ channelId: id })}
        onClick={onPlainClick(context.onFollow)}
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
}

const COMPONENTS: Components = {
  // react-markdown hands over the element's properties (`data-ask-*`).
  sup: (props) => <Marker {...props} />,
  span: (props) => <Entity {...props} />,
};

/** What the parse adds for Ask: its pass, its lists, its two elements. */
function extrasFor(
  text: string,
  entities: readonly AskEntity[],
  markers: readonly AskMarker[],
): MessageMarkdownExtras {
  return {
    remarkPlugins: [
      [remarkAskAnswer, { entities, markers, source: text }],
      remarkAskLists,
    ],
    allowedElements: ASK_RENDER_ELEMENTS,
    components: COMPONENTS,
  };
}

const NO_CHANNELS = () => false;

export function AskMarkdown({
  text,
  citations,
  entities,
  marker,
  canOpenChannel = NO_CHANNELS,
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
  // By value: a caller's list is a new array on every render.
  const entitiesKey = JSON.stringify(entities);
  const citationsKey = JSON.stringify(citations);
  const markers = useMemo(
    () =>
      askMarkers({
        text,
        citations: (JSON.parse(citationsKey) as AskCitation[]).map(
          (citation) => ({ ...citation, quote: "" }),
        ),
      }),
    [text, citationsKey],
  );
  const extras = useMemo(
    () => extrasFor(text, JSON.parse(entitiesKey) as AskEntity[], markers),
    [text, entitiesKey, markers],
  );
  const context = useMemo(
    () => ({ markers, marker, canOpenChannel, onFollow }),
    [markers, marker, canOpenChannel, onFollow],
  );
  return (
    <AskMarkdownContext.Provider value={context}>
      <MessageMarkdown content={text} extras={extras} />
    </AskMarkdownContext.Provider>
  );
}

/** A streaming preview: the same look; an unclosed `**` waits for its close. */
export function AskPreviewMarkdown({ text }: { text: string }) {
  const shown = askPreviewMarkdown(text);
  const extras = useMemo(() => extrasFor(shown, [], []), [shown]);
  return <MessageMarkdown content={shown} extras={extras} />;
}
