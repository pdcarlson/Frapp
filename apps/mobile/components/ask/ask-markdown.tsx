import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import {
  ASK_RENDER_ELEMENTS,
  askMarkers,
  askPreviewMarkdown,
  remarkAskAnswer,
  remarkAskLists,
  type AskMarker,
} from "@repo/chat-core/ask-markdown";
import type { AskCitation, AskEntity, AskSource } from "@repo/validation";
import {
  MessageMarkdown,
  parseMessageMarkdown,
  type MessageMarkdownExtras,
} from "@/components/chat/message-markdown";

/**
 * An answer's words as markdown, on the phone (#5429): bold, italic, code and
 * lists as chat draws a message (`message-markdown.tsx`), with Ask's gold
 * markers and the people and channels the server named
 * (`@repo/chat-core/ask-markdown` says how the three are carried through the
 * parse, and why a link is drawn as its words). Web's twin is
 * `components/ask/ask-markdown.tsx`.
 */

interface AskMarkdownContextValue {
  sources: readonly (AskSource | undefined)[];
  /** Per marker number, the source it stands for. */
  markers: readonly { source: number }[];
  /** What the source is called, for the marker's spoken name. */
  sourceName: (source: AskSource) => string;
  canOpen: (source: AskSource) => boolean;
  onOpenSource: (source: AskSource) => void;
  canOpenChannel: (channelId: string) => boolean;
  onOpenChannel?: (channelId: string) => void;
  markerStyle: StyleProp<TextStyle>;
  mentionStyle: StyleProp<TextStyle>;
}

const AskMarkdownContext = createContext<AskMarkdownContextValue | null>(null);

function useAskMarkdown(): AskMarkdownContextValue {
  const context = useContext(AskMarkdownContext);
  if (!context) throw new Error("An Ask marker rendered outside AskMarkdown");
  return context;
}

/** A property the parse set, as react-markdown hands the node over. */
function propertyOf(node: unknown, name: string): string | null {
  const properties = (node as { properties?: Record<string, unknown> } | null)
    ?.properties;
  const value = properties?.[name];
  return typeof value === "string" ? value : null;
}

function Marker({ node }: { node?: unknown }) {
  const context = useAskMarkdown();
  const marker = context.markers[Number(propertyOf(node, "data-ask-marker"))];
  const source = marker ? context.sources[marker.source] : undefined;
  if (!marker || !source) return null;
  const number = marker.source + 1;
  const opens = context.canOpen(source);
  return (
    <Text
      accessibilityRole={opens ? "link" : undefined}
      accessibilityLabel={`Source ${number}: ${context.sourceName(source)}`}
      onPress={opens ? () => context.onOpenSource(source) : undefined}
      style={context.markerStyle}
    >
      {/* No-break spaces: the marker wraps whole, with the sentence it ends. */}
      {`\u00A0${number}\u00A0`}
    </Text>
  );
}

/**
 * A person or channel the server named: chat's mention look, and a channel
 * the reader has is a link into it.
 */
function Entity({ node, children }: { node?: unknown; children?: ReactNode }) {
  const context = useAskMarkdown();
  const type = propertyOf(node, "data-ask-entity");
  const id = propertyOf(node, "data-ask-id");
  const { onOpenChannel } = context;
  if (type === "channel" && id && onOpenChannel && context.canOpenChannel(id)) {
    return (
      <Text
        accessibilityRole="link"
        onPress={() => onOpenChannel(id)}
        style={context.mentionStyle}
      >
        {children}
      </Text>
    );
  }
  if (type === "member") {
    return <Text style={context.mentionStyle}>{children}</Text>;
  }
  return <>{children}</>;
}

/** This module's own, so React never sees a new element type. */
const COMPONENTS: MessageMarkdownExtras["components"] = {
  sup: ({ node }) => <Marker node={node} />,
  span: ({ node, children }) => <Entity node={node}>{children}</Entity>,
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
  sources,
  entities,
  sourceName,
  canOpen,
  onOpenSource,
  canOpenChannel = NO_CHANNELS,
  onOpenChannel,
  style,
  markerStyle,
  mentionStyle,
}: {
  /** The answer's words as the server wrote them, markdown included. */
  text: string;
  citations: readonly Omit<AskCitation, "quote">[];
  sources: readonly (AskSource | undefined)[];
  entities: readonly AskEntity[];
  sourceName: (source: AskSource) => string;
  canOpen: (source: AskSource) => boolean;
  onOpenSource: (source: AskSource) => void;
  canOpenChannel?: (channelId: string) => boolean;
  onOpenChannel?: (channelId: string) => void;
  style: StyleProp<TextStyle>;
  markerStyle: StyleProp<TextStyle>;
  mentionStyle: StyleProp<TextStyle>;
}) {
  // Parsed once per answer: every turn re-renders while another streams,
  // and a caller's lists are new arrays each time, so they key by value.
  // What only drawing needs reaches the components through context.
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
  const parsed = useMemo(
    () =>
      parseMessageMarkdown(
        text,
        undefined,
        extrasFor(text, JSON.parse(entitiesKey) as AskEntity[], markers),
      ),
    [text, entitiesKey, markers],
  );
  const context = useMemo<AskMarkdownContextValue>(
    () => ({
      sources,
      markers,
      sourceName,
      canOpen,
      onOpenSource,
      canOpenChannel,
      onOpenChannel,
      markerStyle,
      mentionStyle,
    }),
    [
      sources,
      markers,
      sourceName,
      canOpen,
      onOpenSource,
      canOpenChannel,
      onOpenChannel,
      markerStyle,
      mentionStyle,
    ],
  );
  return (
    <AskMarkdownContext.Provider value={context}>
      <MessageMarkdown parsed={parsed} style={style} />
    </AskMarkdownContext.Provider>
  );
}

/** A streaming preview: the same look, with no markers or names yet. */
export function AskPreviewMarkdown({
  text,
  style,
}: {
  text: string;
  style: StyleProp<TextStyle>;
}) {
  // An unclosed `**` waits for the chunk that closes it.
  const parsed = useMemo(() => {
    const shown = askPreviewMarkdown(text);
    return parseMessageMarkdown(shown, undefined, extrasFor(shown, [], []));
  }, [text]);
  return <MessageMarkdown parsed={parsed} style={style} />;
}
