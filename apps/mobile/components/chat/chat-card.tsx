import { useMemo, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ChatMessage } from "@repo/chat-core/types";
import { formatPointsChip } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
import {
  deliveryChrome,
  type DeliveryChrome,
} from "@/lib/chat/delivery-status";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { eyebrowStyle } from "@/components/eyebrow";
import { HairlineChip } from "@/components/status-chip";
import type { TabGlyphProps } from "@/components/tab-glyphs";
import {
  groupReactions,
  messageActionsA11yProps,
  ReactionRow,
} from "./message-item";
import type { MessageLink } from "./message-markdown";

/**
 * The frame every mobile chat card shares: the poll, sign-up sheet, event,
 * task, points, service hours, rush candidate and announcement cards (#3185,
 * #3383, #3926). An
 * audit entry is a line, not a card (`system-audit-card.tsx`).
 *
 * `thread-message-row.tsx` puts a card inside `MessageRowFrame`, which draws
 * the reply quote, the avatar and the author line every row has. The frame
 * here draws the rest of the chrome, so a card message keeps the affordances
 * every other mobile message has:
 *
 * - **The long-press** opens the message actions sheet, on a wrapper that is
 *   not itself an accessibility element, so the card's own buttons stay
 *   reachable.
 * - **The screen-reader actions** sit on an accessible `View` around the
 *   card's header text, never on a bare `Text` (see `messageActionsA11yProps`).
 * - **Delivery status**, from `message._status`/`_error` through the
 *   exhaustive `deliveryChrome` (#1910): a card is optimistic, failed or
 *   unconfirmed under the same `sendMessage` contract any other kind is.
 * - **Reactions**, through `ReactionRow` from `message-item.tsx` rather than a
 *   copy of it.
 *
 * The parts below the frame (`CardEyebrow`, `CardButton`, `CardNote`, …) are
 * the pieces web's renderers draw from `chip.ts` and the shared UI kit, so
 * every card kind on the phone reads as one family.
 */

/** What every card takes from its row, whatever its kind. */
export interface ChatCardFrameProps {
  message: ChatMessage;
  viewerId: string;
  /** Confirmed rows can be acted on; pending optimistic rows cannot. */
  isConfirmed: boolean;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onUnreact: (messageId: string, emoji: string) => void;
  /**
   * Opens the message actions sheet, the same one `MessageItem` uses. Which
   * rows the sheet shows is `messageActionsFor`'s call, not this prop's.
   */
  onOpenActions?: () => void;
  /**
   * Scrolls to the parent when this card is a reply whose parent is shown: the
   * screen-reader twin of the tappable quote above the row.
   */
  onJumpToParent?: () => void;
}

export function ChatCardShell({
  message,
  viewerId,
  isConfirmed,
  onRetry,
  onDiscard,
  onReact,
  onUnreact,
  onOpenActions,
  onJumpToParent,
  header,
  links,
  children,
}: ChatCardFrameProps & {
  /** The card's own text, which carries the message's screen-reader actions. */
  header: ReactNode;
  /**
   * The links the header draws, from `parseMessageMarkdown`. The header's
   * accessible container makes them unreachable one by one, so each rides it
   * as "Open <link>", as a plain message's links do.
   */
  links?: MessageLink[];
  /** Everything under the header: options, meta lines, actions, notes. */
  children?: ReactNode;
}) {
  const styles = useCardStyles();
  const a11yActions = messageActionsA11yProps(onOpenActions, {
    links,
    onJumpToParent,
  });
  const hasActions = "accessibilityActions" in a11yActions;

  return (
    <Pressable
      accessible={false}
      onLongPress={onOpenActions}
      disabled={!onOpenActions}
      style={[
        styles.card,
        message._status === "pending" ? styles.cardPending : null,
      ]}
    >
      <View
        accessible={hasActions || message._status === "pending"}
        // The dimmed card is the whole pending state on screen; a screen
        // reader hears it here.
        accessibilityHint={
          message._status === "pending" ? "Sending" : undefined
        }
        {...a11yActions}
      >
        {header}
      </View>
      {children}
      <CardDeliveryChrome
        chrome={deliveryChrome(message)}
        clientMessageId={message.client_message_id}
        onRetry={onRetry}
        onDiscard={onDiscard}
      />
      <ReactionRow
        reactions={groupReactions(message, viewerId)}
        messageId={message.id}
        disabled={!isConfirmed}
        onReact={onReact}
        onUnreact={onUnreact}
        onLongPress={onOpenActions}
        styles={styles}
      />
    </Pressable>
  );
}

/**
 * Card delivery chrome. Exhaustive over `DeliveryChrome` so a new
 * `MessageStatus` cannot render as a fully-sent card.
 *
 * Retry/Discard stay on `failed` only. `unconfirmed` is a muted note with no
 * control: mobile has no slash replay path, and discard is never safe.
 */
function CardDeliveryChrome({
  chrome,
  clientMessageId,
  onRetry,
  onDiscard,
}: {
  chrome: DeliveryChrome;
  clientMessageId: string;
  onRetry: (clientMessageId: string) => void;
  onDiscard: (clientMessageId: string) => void;
}) {
  const styles = useCardStyles();
  switch (chrome.status) {
    case "pending":
      // The card dims instead (`styles.cardPending`): no line under it.
      return null;
    case "failed":
      return (
        <View style={styles.failedRow}>
          <Text style={styles.metaFailed}>{chrome.error}</Text>
          <View style={styles.failedActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry sending this message"
              hitSlop={8}
              onPress={() => onRetry(clientMessageId)}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard this message"
              hitSlop={8}
              onPress={() => onDiscard(clientMessageId)}
            >
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      );
    case "unconfirmed":
    case "recorded":
      return (
        <Text style={styles.metaText} accessibilityLiveRegion="polite">
          {chrome.note}
        </Text>
      );
    case "confirmed":
      return null;
    default: {
      const _never: never = chrome;
      return _never;
    }
  }
}

/**
 * The kind label over a card's title: "POLL", "EVENT", "TASK".
 *
 * Always neutral, glyph and label together in the muted foreground: a card's
 * kind label is a label, and the accent is kept for the card's one primary
 * action (`CardButton`'s `primary`) and the member's on-states
 * (foundations.md §6, "Where the accent goes", 2026-11-05). The glyph draws
 * at rest, never lifted like a focused tab. `trailing` sits at the far end
 * of the row (a status chip).
 */
export function CardEyebrow({
  label,
  glyph: Glyph,
  trailing,
}: {
  label: string;
  glyph?: ComponentType<TabGlyphProps>;
  trailing?: ReactNode;
}) {
  const styles = useCardStyles();
  const { tokens } = useFrappTheme();
  const muted = tokens.color.text.mutedForeground;
  return (
    <View style={styles.eyebrowRow}>
      <View style={styles.eyebrowLead}>
        {Glyph ? (
          <Glyph focused={false} accent={muted} muted={muted} size={16} />
        ) : null}
        <Text style={styles.eyebrow}>{label}</Text>
      </View>
      {trailing}
    </View>
  );
}

/** The card's headline: a poll's question, an event's or task's name. */
export function CardTitle({ children }: { children: ReactNode }) {
  const styles = useCardStyles();
  return <Text style={styles.title}>{children}</Text>;
}

/**
 * One muted line of facts under the title, joined with a middle dot as web's
 * cards join theirs. Falsy items are dropped, so a caller can pass optional
 * facts inline, and a line with none draws nothing.
 *
 * A card draws several lines rather than one long one, grouped so each fits a
 * phone: a wrapped line would start with a stray dot. An item too long for
 * the line, such as a long location, wraps inside itself.
 */
export function CardMeta({ items }: { items: ReactNode[] }) {
  const styles = useCardStyles();
  const shown = items.filter(
    (item) =>
      item !== null && item !== undefined && item !== false && item !== "",
  );
  if (shown.length === 0) return null;
  return (
    <View style={styles.metaRow}>
      {shown.map((item, index) => (
        <View key={index} style={styles.metaItem}>
          {index > 0 ? (
            <Text style={[styles.metaLine, styles.metaSeparator]}>·</Text>
          ) : null}
          {typeof item === "string" ? (
            <Text style={[styles.metaLine, styles.metaShrink]}>{item}</Text>
          ) : (
            item
          )}
        </View>
      ))}
    </View>
  );
}

/** One word or phrase of a {@link CardSentence}, and how it reads. */
export interface CardSentencePart {
  text: string;
  /**
   * `strong` for a name or a quantity, `muted` for the words between them;
   * `success` and `destructive` are a strong part in a status hue, a points
   * grant or deduction.
   */
  tone?: "strong" | "muted" | "success" | "destructive";
}

/**
 * A record card's body sentence at the body role, the words web's points and
 * hours cards draw: "Paul Carlson granted +5 points to Elias Brandt". Parts
 * are joined with a space and wrap as one line of text.
 */
export function CardSentence({ parts }: { parts: CardSentencePart[] }) {
  const styles = useCardStyles();
  const { tokens } = useFrappTheme();
  return (
    <Text style={styles.bodyText}>
      {parts.map((part, index) => {
        const tone = part.tone ?? "strong";
        const style =
          tone === "muted"
            ? styles.sentenceMuted
            : [
                styles.sentenceStrong,
                tone === "success"
                  ? { color: tokens.color.semantic.success }
                  : tone === "destructive"
                    ? { color: tokens.color.semantic.destructive }
                    : null,
              ];
        return (
          <Text key={index} style={style}>
            {index > 0 ? " " : ""}
            {part.text}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * A member's own words on a record card, in curly quotes and muted: a points
 * reason, an hours description.
 */
export function CardQuote({ text }: { text: string }) {
  const styles = useCardStyles();
  return <Text style={styles.quote}>{`“${text}”`}</Text>;
}

/** A meta-line fact with a leading glyph, such as an event's location. */
export function CardMetaWithGlyph({
  glyph,
  text,
}: {
  glyph: ReactNode;
  text: string;
}) {
  const styles = useCardStyles();
  return (
    <View style={styles.metaGlyphItem}>
      {glyph}
      <Text style={[styles.metaLine, styles.metaShrink]}>{text}</Text>
    </View>
  );
}

/**
 * "+10 pts": the reward a card offers, in §5's hairline kind
 * (`HairlineChip`), as web's outline badge draws it. Not a status chip: §5
 * keeps those for status, and a reward is not one. It sits beside the event
 * card's Mandatory, which is the same chip (#4132).
 */
export function PointsChip({ points }: { points: number }) {
  return <HairlineChip label={formatPointsChip(points)} />;
}

/** The row a card's buttons sit in, wrapping on a narrow phone. */
export function CardActions({ children }: { children: ReactNode }) {
  const styles = useCardStyles();
  return <View style={styles.actions}>{children}</View>;
}

/**
 * One card action. `primary` is the chapter's solid-fill pair
 * (accent-engine.md §8), the one a card's main action takes; `secondary` is an
 * outline. A disabled button keeps its label and explains itself through
 * `accessibilityHint`, so a screen reader hears why it can't be pressed.
 */
export function CardButton({
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  accessibilityHint,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  accessibilityHint?: string;
  /** Drawn before the label, in the label's color. */
  icon?: (color: string) => ReactNode;
}) {
  const styles = useCardStyles();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const primary = variant === "primary";
  const labelColor = primary
    ? brand.accentOnPrimary
    : tokens.color.text.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: brand.accentPrimary }
          : styles.buttonSecondary,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null,
      ]}
    >
      {icon ? icon(labelColor) : null}
      <Text style={[styles.buttonLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A line of outcome under a card's actions: what a tap did, or why it
 * couldn't. Mobile has no toast, so this is where web's toast copy lands. A
 * polite live region, so a screen reader hears it without moving focus.
 */
export function CardNote({
  text,
  tone = "muted",
}: {
  text: string;
  tone?: "muted" | "success" | "error";
}) {
  const styles = useCardStyles();
  const { tokens } = useFrappTheme();
  const color =
    tone === "success"
      ? tokens.color.semantic.success
      : tone === "error"
        ? tokens.color.semantic.destructive
        : tokens.color.text.mutedForeground;
  return (
    <Text style={[styles.note, { color }]} accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

/**
 * The frame's styles, for a card that draws something the parts above don't
 * cover in the same type and spacing.
 */
export function useCardStyles() {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  return useMemo(() => createStyles(tokens, brand), [tokens, brand]);
}

/**
 * Web's 28rem (`MESSAGE_CARD`'s `w-[28rem] max-w-full`): the widest a chat
 * card draws on either app.
 */
const CARD_MAX_WIDTH = 448;

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  return StyleSheet.create({
    // The body column's full width up to web's cap (`MESSAGE_CARD`'s
    // 28rem, 448), so a card is one width on both apps and a tablet's
    // wide column doesn't stretch it (#4136).
    card: {
      maxWidth: CARD_MAX_WIDTH,
      marginTop: tokens.spacing.xs,
      // components.md's card padding, the 16 web's MESSAGE_CARD draws.
      padding: tokens.spacing.lg,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    // In flight: the whole card grays, as a pending message's text does.
    cardPending: { opacity: 0.5 },
    eyebrowRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    eyebrowLead: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs + 2,
      flexShrink: 1,
    },
    // The eyebrow recipe web's EYEBROW draws.
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    title: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.foreground,
      // 8 under the eyebrow, 8 to the meta and 12 to the actions: web's
      // card spacing, one rhythm on both apps (#4136).
      marginTop: tokens.spacing.sm,
    },
    // A card's body copy: a record card's sentence, an announcement's text.
    bodyText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.sm,
    },
    sentenceStrong: {
      ...typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.foreground,
    },
    sentenceMuted: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    quote: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      rowGap: tokens.spacing.xs,
      marginTop: tokens.spacing.sm,
    },
    metaItem: {
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
    },
    metaGlyphItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      flexShrink: 1,
    },
    metaShrink: {
      flexShrink: 1,
    },
    metaLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    metaSeparator: {
      marginHorizontal: tokens.spacing.xs + 2,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.md,
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.xs + 2,
      minHeight: 44,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.popover,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      marginTop: tokens.spacing.sm,
    },
    // Matches `MessageItem`'s delivery line in message-item.tsx: same
    // pending/failed/unconfirmed/recorded treatment.
    metaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      marginTop: tokens.spacing.sm + 1,
    },
    failedRow: {
      marginTop: tokens.spacing.sm + 1,
      gap: tokens.spacing.xs,
    },
    metaFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    failedActions: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    retryText: {
      ...typeRole(tokens.typography.role.caption),
      color: brand.accent,
    },
    discardText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // Matches `MessageItem`'s equivalent styles: `ReactionRow` (imported from
    // message-item.tsx) is narrowed to exactly these five keys.
    reactionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm - 2,
      marginTop: tokens.spacing.sm + 1,
    },
    reactionChip: {
      height: 26,
      paddingHorizontal: tokens.spacing.sm + 1,
      borderRadius: tokens.radius.chip + 1,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    reactionChipMine: {
      backgroundColor: brand.accentSubtle,
      borderWidth: 1,
      borderColor: brand.accentBorder,
    },
    // The reacted chip is the Accent badge recipe (components.md §5), so both
    // states carry its 12.5 / 600.
    reactionText: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
    reactionTextMine: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: brand.accent,
    },
  });
}
