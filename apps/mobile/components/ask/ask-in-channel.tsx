import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  askChannelPostOffer,
  askTurnsInChannel,
  useAsk,
  useAskPostFlow,
  type AskExchange,
  type AskOptions,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  ASK_COPY,
  ASK_MENTION_NAME,
  ASK_POST_COPY,
  askPostRestrictedList,
  type AskAnswer,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import { AskReply } from "@/components/ask/ask-turn";
import {
  SOURCE_OPEN_FAILED,
  useAskTurns,
} from "@/components/ask/use-ask-turns";
import { MESSAGE_AVATAR_SIZE } from "@/components/chat/message-item";
import { EyeOffGlyph } from "@/components/control-glyphs";
import { FrappCrest } from "@/components/frapp-crest";
import { useAiSurfaces, useMayAct } from "@/lib/ai/availability";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  avatarRadius,
  fontFamilyFor,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";

/**
 * `@Frapp` in a channel on the phone, answered to the asker alone (#4713).
 * Web's twin is `apps/web/components/ask/ask-in-channel.tsx`, which says why
 * it is drawn this way and names what it is modelled on (Slack's "Only
 * visible to you", Discord's "Only you can see this · Dismiss message").
 *
 * A member with Ask picks Frapp from the composer's `@` list, types a
 * question and sends. Nothing is posted: the question goes to Ask, and the
 * answer is drawn in the channel where it was asked, under the message that
 * was newest at the time, for this member and nobody else. It is a turn of
 * the one Ask conversation (`lib/ask/ask-conversation.tsx`), so the Ask sheet
 * shows it too and a follow-up there leans on it; it is not a row in the
 * channel's messages, and is gone when the app restarts, like the rest of
 * the conversation (`spec/behavior/ai.md` § One conversation).
 *
 * The "answers are being saved" line is shown only in the Ask sheet's own
 * field, so a question from a channel never says it was shown and the beta
 * diagnostics window keeps nothing from it.
 */
export interface ChannelAsk {
  /** A question is being answered: a second one waits its turn. */
  busy: boolean;
  /** Ask from this channel; `after` is its newest message's key. */
  send: (question: string, after: string | null) => void;
  /** The turns asked in this channel and still shown there, oldest first. */
  turns: AskExchange[];
  /** One turn, drawn as a row of the thread. */
  renderTurn: (exchange: AskExchange) => ReactNode;
  /** The consent and report sheets, drawn once by the screen. */
  sheets: ReactNode;
}

/**
 * Asking from one channel's screen, or `null` for a member without Ask (who
 * gets no Frapp in the `@` list, and whose `@Frapp` is ordinary text).
 */
export function useChannelAsk(
  channelId: string | null | undefined,
): ChannelAsk | null {
  const { ask: hasAsk } = useAiSurfaces();
  const conversation = useAsk();
  const { exchanges, working, ask, dismissFromChannel } = conversation;
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const mayAct = useMayAct();

  // The same asks the sheet makes, less the saved line (see above).
  const options = useCallback(
    (): AskOptions => ({ actions: mayAct, gate: ensureConsent }),
    [mayAct, ensureConsent],
  );
  const turnActions = useAskTurns({ conversation, options });

  const send = useCallback(
    (question: string, after: string | null) => {
      if (!channelId) return;
      void ask(question, { ...options(), channelId, afterMessage: after });
    },
    [ask, options, channelId],
  );
  const turns = useMemo(
    () => (hasAsk ? askTurnsInChannel(exchanges, channelId) : NO_TURNS),
    [hasAsk, exchanges, channelId],
  );

  if (!hasAsk) return null;
  return {
    busy: working,
    send,
    turns,
    renderTurn: (exchange) => (
      <AskChannelTurn
        key={exchange.id}
        exchange={exchange}
        reply={turnActions.propsFor(exchange)}
        sourceFailed={turnActions.sourceFailed(exchange.id)}
        onDismiss={() => dismissFromChannel(exchange.id)}
      />
    ),
    sheets: (
      <>
        {consentSheet}
        {turnActions.reportSheet}
      </>
    ),
  };
}

const NO_TURNS: AskExchange[] = [];

interface AskTurnsPlaced {
  byRow: ReadonlyMap<string, readonly AskExchange[]>;
  renderTurn: (exchange: AskExchange) => ReactNode;
}

/**
 * Where a channel's turns sit, for the rows of its list to read: by the key
 * of the message each is drawn under (`placeAskTurns`).
 *
 * A store the rows subscribe to, not a prop of the list's `renderItem` and
 * not a value closed over by it: what a turn does changes as its answer
 * streams in, and a `renderItem` that changed with it would redraw every
 * message on screen for each word. The store itself never changes identity,
 * so `renderItem` stays as it was; only `AskTurnsUnder` reads it, and it
 * draws nothing for a row with no turn.
 */
export interface AskTurnsPlacement {
  subscribe: (listener: () => void) => () => void;
  get: () => AskTurnsPlaced | null;
}

export function useAskTurnsPlacement(
  byRow: ReadonlyMap<string, readonly AskExchange[]>,
  renderTurn: ((exchange: AskExchange) => ReactNode) | undefined,
): AskTurnsPlacement {
  const [store] = useState(() => {
    let placed: AskTurnsPlaced | null = null;
    const listeners = new Set<() => void>();
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      get: () => placed,
      set: (next: AskTurnsPlaced | null) => {
        if (next === placed) return;
        placed = next;
        listeners.forEach((listener) => listener());
      },
    };
  });
  // After every render: while this channel has a turn, what one does is new
  // each time (a word arrived, a source is opening). With none there is
  // nothing to tell the rows, and nothing is.
  useLayoutEffect(() => {
    store.set(renderTurn && byRow.size > 0 ? { byRow, renderTurn } : null);
  });
  return store;
}

/** The turns drawn under one row, or above them all (`ASK_TURNS_ABOVE_ALL`). */
export function AskTurnsUnder({
  placement,
  rowKey,
}: {
  placement: AskTurnsPlacement;
  rowKey: string;
}) {
  const placed = useSyncExternalStore(
    placement.subscribe,
    placement.get,
    placement.get,
  );
  const turns = placed?.byRow.get(rowKey);
  if (!placed || !turns || turns.length === 0) return null;
  return <>{turns.map(placed.renderTurn)}</>;
}

/**
 * One turn, drawn among a channel's messages for the member who asked it.
 * A message row's measures (`message-item.tsx`: 16pt sides, a 32pt gutter,
 * 12pt to the words, 16pt above a new speaker), so it lines up with the
 * messages either side of it.
 *
 * It reads as Frapp speaking in the channel, marked as private. What tells
 * it apart is said, not coloured: "Only you can see this" beside the name,
 * and the member's own question quoted above the answer, since no message of
 * theirs is there to show what was asked. Dismiss takes it out of the
 * channel; it stays in Ask.
 */
function AskChannelTurn({
  exchange,
  reply,
  sourceFailed = false,
  onDismiss,
}: {
  exchange: AskExchange;
  /** What the turn's answer takes (`useAskTurns`). */
  reply: Parameters<typeof AskReply>[0];
  /** A source of this turn's didn't open. */
  sourceFailed?: boolean;
  onDismiss: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <View testID={`ask-channel-turn-${exchange.id}`} style={styles.row}>
      <View
        style={styles.mark}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <FrappCrest height={17} color={accent} />
      </View>
      <View style={styles.column}>
        <View
          style={styles.nameLine}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${ASK_MENTION_NAME}. ${ASK_COPY.only_you}.`}
        >
          <Text style={styles.name}>{ASK_MENTION_NAME}</Text>
          <View style={styles.private}>
            <EyeOffGlyph color={tokens.color.text.mutedForeground} size={12} />
            <Text style={styles.caption}>{ASK_COPY.only_you}</Text>
          </View>
        </View>
        {/* The member's own words: no message of theirs was posted, so the
            turn has to say what was asked. */}
        <View style={styles.quote}>
          <Text style={styles.question}>{exchange.question}</Text>
        </View>
        <AskReply {...reply} />
        {sourceFailed ? (
          <Text accessibilityLiveRegion="polite" style={styles.caption}>
            {SOURCE_OPEN_FAILED}
          </Text>
        ) : null}
        {exchange.phase !== "working" ? (
          <AskChannelTurnActions exchange={exchange} onDismiss={onDismiss} />
        ) : null}
      </View>
    </View>
  );
}

/** A quiet text action under a turn: a caption's line, 44pt to a finger. */
function TurnAction({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={14}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      <Text style={styles.caption}>{label}</Text>
    </Pressable>
  );
}

/**
 * What the asker can do with a finished turn: take it out of the channel,
 * and, for an answer, post it for everyone here (#4713). A card, a refusal
 * and a turn with nothing found have nothing to post; nor does an answer
 * from a server that sealed no receipt, since the receipt is what is posted.
 */
function AskChannelTurnActions({
  exchange,
  onDismiss,
}: {
  exchange: AskExchange;
  onDismiss: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const dismiss = (
    <TurnAction
      label={ASK_COPY.dismiss}
      hint="Takes this answer out of the channel. It stays in Ask Frapp."
      onPress={onDismiss}
    />
  );
  const offer = askChannelPostOffer(exchange);
  if (offer.kind === "none") {
    return <View style={styles.actions}>{dismiss}</View>;
  }
  if (offer.kind === "stays") {
    return (
      <View style={styles.actions}>
        {dismiss}
        <Text style={styles.caption}>{offer.reason}</Text>
      </View>
    );
  }
  return (
    <AskPostActions
      channelId={offer.channelId}
      answer={offer.answer}
      // Once it is in the channel for everyone, the asker's own copy of it
      // there would be the same answer twice. It stays in Ask.
      onPosted={onDismiss}
    >
      {dismiss}
    </AskPostActions>
  );
}

/**
 * "Post for everyone here", in three steps and one place; web's twin of the
 * same name says what it is modelled on. Pressing the action only asks the
 * server who else in the channel could open what the answer drew on. Then,
 * where the action was, what posting does and what not everyone can open,
 * with Post and Cancel.
 */
function AskPostActions({
  channelId,
  answer,
  onPosted,
  children,
}: {
  channelId: string;
  answer: AskAnswer;
  onPosted: () => void;
  /** Dismiss, drawn beside the action while nothing is being confirmed. */
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const flow = useAskPostFlow({ channelId, answer, onPosted });
  const error = flow.error ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {flow.error}
    </Text>
  ) : null;
  if (flow.stage === "idle" || flow.stage === "checking") {
    return (
      <View style={styles.actionsColumn}>
        <View style={styles.actions}>
          {children}
          {flow.stage === "checking" ? (
            // In the action's place and its size, so nothing moves.
            <Text accessibilityLiveRegion="polite" style={styles.caption}>
              {ASK_POST_COPY.checking}
            </Text>
          ) : (
            <TurnAction label={ASK_POST_COPY.action} onPress={flow.start} />
          )}
        </View>
        {error}
      </View>
    );
  }
  const posting = flow.stage === "posting";
  const warned = flow.restricted.length > 0;
  const postLabel = posting
    ? ASK_POST_COPY.posting
    : warned
      ? ASK_POST_COPY.post_anyway
      : ASK_POST_COPY.post;
  return (
    <View
      accessibilityLabel={ASK_POST_COPY.action}
      style={styles.confirm}
      testID="ask-post-confirm"
    >
      {flow.changed ? (
        <Text accessibilityLiveRegion="polite" style={styles.caption}>
          {ASK_POST_COPY.changed}
        </Text>
      ) : null}
      <Text style={styles.confirmText}>{ASK_POST_COPY.confirm}</Text>
      {warned ? (
        <View style={styles.warning}>
          <View style={styles.warningGlyph}>
            <EyeOffGlyph color={tokens.color.text.mutedForeground} size={14} />
          </View>
          <Text style={[styles.confirmText, styles.warningText]}>
            {ASK_POST_COPY.warning}:{" "}
            <Text style={styles.strong}>
              {askPostRestrictedList(flow.restricted)}
            </Text>
            .
          </Text>
        </View>
      ) : null}
      {error}
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={postLabel}
          accessibilityState={{ disabled: posting, busy: posting }}
          disabled={posting}
          // 36pt drawn against the 44pt minimum.
          hitSlop={4}
          onPress={flow.confirm}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: accentPrimary, borderColor: accentPrimary },
            pressed || posting ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.buttonText, { color: accentOnPrimary }]}>
            {postLabel}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ASK_POST_COPY.cancel}
          accessibilityState={{ disabled: posting }}
          disabled={posting}
          hitSlop={4}
          onPress={flow.cancel}
          style={({ pressed }) => [
            styles.button,
            pressed || posting ? styles.pressed : null,
          ]}
        >
          <Text style={styles.buttonText}>{ASK_POST_COPY.cancel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingTop: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xs,
    },
    mark: {
      width: MESSAGE_AVATAR_SIZE,
      height: MESSAGE_AVATAR_SIZE,
      borderRadius: avatarRadius(MESSAGE_AVATAR_SIZE),
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      alignItems: "center",
      justifyContent: "center",
    },
    column: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.sm,
    },
    nameLine: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: tokens.spacing.sm,
    },
    name: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    private: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: tokens.color.border.hairline,
      paddingLeft: 10,
    },
    question: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    actionsColumn: {
      gap: tokens.spacing.xs,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: tokens.spacing.xl,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    confirm: {
      gap: tokens.spacing.sm,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderRadius: tokens.radius.card,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: 10,
    },
    confirmText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    warning: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
    },
    warningGlyph: {
      paddingTop: 3,
    },
    warningText: {
      flex: 1,
      minWidth: 0,
    },
    strong: {
      fontFamily: fontFamilyFor(600),
    },
    buttons: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    button: {
      height: 36,
      minWidth: 64,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    buttonText: {
      ...typeRole(tokens.typography.role.label),
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
