import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { useChatCatchUp, type ChatCatchUpTarget } from "@repo/hooks";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  CHAT_CATCH_UP_COPY,
  CHAT_CATCH_UP_POINT_KINDS,
  chatCatchUpGroupOf,
  chatCatchUpNotes,
  chatCatchUpSince,
  chatCatchUpTooLittleLine,
  chatCatchUpUnavailableLine,
  chatCatchUpWhen,
  type ChatCatchUp,
  type ChatCatchUpPoint,
  type ChatCatchUpRange,
} from "@repo/validation";
import { useAiConsentGate } from "@/components/ai/meet-frapp-ai";
import {
  useAiReport,
  type AiReportTarget,
} from "@/components/ai/report-ai-sheet";
import { CloseGlyph } from "@/components/control-glyphs";
import { eyebrowStyle } from "@/components/eyebrow";
import { Segmented } from "@/components/segmented";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { fontFamilyFor, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Catch me up on the phone (#3946, `spec/behavior/ai.md` § Catch me up): a
 * member back from class opens a busy channel and asks for the short version.
 * They get a few lines, each one a door to the message it came from. Web's
 * twin is `apps/web/components/chat/catch-up-panel.tsx`; both ask the same
 * route (`useChatCatchUp`) and say the same words (`CHAT_CATCH_UP_COPY`).
 *
 * **Where the others put it.** Slack's recap on a phone is a sheet over the
 * channel whose lines jump to their messages; Discord's summaries sit above
 * the channel as a strip to jump from. This takes both: a strip under the
 * header offers it when a channel opens with many new messages
 * ({@link CatchUpStrip}), the header's menu and a thread's header offer it
 * any time, and the summary itself is a sheet.
 *
 * **A line opens its message, and the summary waits.** A phone can't show
 * the sheet and the message side by side as web's panel does, so tapping a
 * line closes the sheet and scrolls to the message. The same strip then
 * reads "Your summary is still here", and leads back to the same summary:
 * reading four lines costs one request, not four. Swiping the sheet away
 * ends the summary, and so does leaving the channel.
 *
 * **Only the member's, and never stored.** The summary lives in this hook's
 * state. Report this is the one way any of it is kept
 * (`report-ai-sheet.tsx` says what, for whom and for how long before it
 * sends).
 *
 * **Consent is asked at the first summary**, not when an entry point shows
 * (`useAiConsentGate`). The server checks again.
 *
 * **Nothing moves while it works.** The sheet opens at one fixed height with
 * its title and range control in place; the working line sits where the
 * first group lands.
 */

const SNAP_POINTS = ["78%"];

/** What a summary is of. The same shape web's panel takes. */
export type CatchUpScope =
  | {
      kind: "channel";
      channelId: string;
      channelName: string | null;
      /**
       * The stretch that was new when the member opened the channel, or null
       * when there was none (or it is not known).
       */
      unread: { count: number; as_of: string } | null;
    }
  | {
      kind: "thread";
      channelId: string;
      channelName: string | null;
      rootId: string;
    };

type Held = { kind: "consent" } | { kind: "failed"; message: string };

function targetFor(
  scope: CatchUpScope,
  range: ChatCatchUpRange,
): ChatCatchUpTarget {
  if (scope.kind === "thread") return { thread_root_id: scope.rootId };
  if (range === "unread" && scope.unread) return { unread: scope.unread };
  return {
    since: chatCatchUpSince(range === "week" ? "week" : "day", new Date()),
  };
}

export interface CatchUp {
  /** Asks for a summary straight away and opens the sheet on it. */
  start: (scope: CatchUpScope) => void;
  /**
   * A summary is waiting behind a message the member opened from it.
   * `resume` brings the sheet back; `drop` ends the summary.
   */
  waiting: boolean;
  resume: () => void;
  drop: () => void;
  /** The sheet is up, or a summary is waiting: no offer should show. */
  active: boolean;
  /** Render once in the screen. */
  sheets: ReactNode;
}

/**
 * The sheet and what opens it, for one screen (a channel or a thread).
 * `start` asks for a summary of the thread, of the new stretch when the
 * channel had one, otherwise of the last 24 hours.
 */
export function useCatchUp({
  channelId,
  nameFor,
  onOpenPoint,
}: {
  /** The channel on screen. A summary of any other channel is dropped. */
  channelId: string | null;
  nameFor: (userId: string) => string | null | undefined;
  /** Opens the message a line rests on. The sheet has already closed. */
  onOpenPoint: (point: ChatCatchUpPoint) => void;
}): CatchUp {
  const sheetRef = useRef<BottomSheetModal>(null);
  const { current, run, reset } = useChatCatchUp();
  const { ensureConsent, consentSheet } = useAiConsentGate();
  const reporting = useAiReport();
  const [scope, setScope] = useState<CatchUpScope | null>(null);
  const [range, setRange] = useState<ChatCatchUpRange>("day");
  // A summary that never reached the server: no answer on the AI sheet yet,
  // or the answer could not be read.
  const [held, setHeld] = useState<Held | null>(null);
  // The sheet closed so the member could look at a message.
  const [away, setAway] = useState(false);
  const leavingForPoint = useRef(false);

  const end = useCallback(() => {
    setScope(null);
    setHeld(null);
    setAway(false);
    reset();
  }, [reset]);

  // Leaving the channel ends its summary. This screen stays mounted across a
  // channel switch, so what it held is dropped during render, and a request
  // in flight and a sheet left up go with the old channel.
  const [seenChannelId, setSeenChannelId] = useState(channelId);
  if (seenChannelId !== channelId) {
    setSeenChannelId(channelId);
    setScope(null);
    setHeld(null);
    setAway(false);
  }
  useEffect(
    () => () => {
      reset();
      sheetRef.current?.dismiss();
    },
    [channelId, reset],
  );

  const summarize = useCallback(
    async (next: CatchUpScope, nextRange: ChatCatchUpRange) => {
      setHeld(null);
      let agreed: boolean;
      try {
        agreed = await ensureConsent();
      } catch (error) {
        setHeld({
          kind: "failed",
          message: errorCopy(error, CHAT_CATCH_UP_COPY.failed),
        });
        return;
      }
      if (!agreed) {
        setHeld({ kind: "consent" });
        return;
      }
      await run(next.channelId, targetFor(next, nextRange));
    },
    [ensureConsent, run],
  );

  const start = useCallback(
    (next: CatchUpScope) => {
      const nextRange: ChatCatchUpRange =
        next.kind === "channel" && next.unread ? "unread" : "day";
      reset();
      setAway(false);
      setScope(next);
      setRange(nextRange);
      // The keyboard first, as every sheet door in chat does (#4142): a
      // sheet opened over the open keyboard sits under it on iOS.
      Keyboard.dismiss();
      sheetRef.current?.present();
      void summarize(next, nextRange);
    },
    [reset, summarize],
  );

  const resume = useCallback(() => {
    setAway(false);
    Keyboard.dismiss();
    sheetRef.current?.present();
  }, []);

  const onDismiss = useCallback(() => {
    if (leavingForPoint.current) {
      leavingForPoint.current = false;
      setAway(true);
      return;
    }
    end();
  }, [end]);

  const openPoint = useCallback(
    (point: ChatCatchUpPoint) => {
      leavingForPoint.current = true;
      sheetRef.current?.dismiss();
      onOpenPoint(point);
    },
    [onOpenPoint],
  );

  const shown =
    scope && current?.channelId === scope.channelId ? current : null;

  const sheets = (
    <>
      <CatchUpSheet
        sheetRef={sheetRef}
        scope={scope}
        range={range}
        held={held}
        run={shown}
        nameFor={nameFor}
        onRange={(next) => {
          if (!scope) return;
          setRange(next);
          void summarize(scope, next);
        }}
        onAgain={() => {
          if (scope) void summarize(scope, range);
        }}
        onOpenPoint={openPoint}
        onDismiss={onDismiss}
        report={reporting}
      />
      {consentSheet}
      {reporting.reportSheet}
    </>
  );

  return {
    start,
    waiting: away && scope !== null,
    resume,
    drop: end,
    active: scope !== null,
    sheets,
  };
}

type Reporting = ReturnType<typeof useAiReport>;
type Run = ReturnType<typeof useChatCatchUp>["current"];

interface CatchUpSheetProps {
  scope: CatchUpScope | null;
  range: ChatCatchUpRange;
  held: Held | null;
  run: Run;
  nameFor: (userId: string) => string | null | undefined;
  onRange: (range: ChatCatchUpRange) => void;
  onAgain: () => void;
  onOpenPoint: (point: ChatCatchUpPoint) => void;
  onDismiss: () => void;
  report: Reporting;
}

function CatchUpSheet({
  sheetRef,
  scope,
  range,
  held,
  run,
  nameFor,
  onRange,
  onAgain,
  onOpenPoint,
  onDismiss,
  report,
}: CatchUpSheetProps & { sheetRef: RefObject<BottomSheetModal | null> }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const close = useCallback(() => sheetRef.current?.dismiss(), [sheetRef]);
  const working = !held && run?.phase === "working";

  return (
    <BottomSheetModal
      ref={sheetRef}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      // One fixed height: with dynamic sizing the sheet would grow with
      // every group that lands.
      enableDynamicSizing={false}
      snapPoints={SNAP_POINTS}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={onDismiss}
    >
      <SheetBackToClose onClose={close} />
      {scope ? (
        <BottomSheetScrollView
          onAccessibilityEscape={close}
          contentContainerStyle={styles.body}
        >
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>
              {scope.kind === "thread"
                ? CHAT_CATCH_UP_COPY.thread_title
                : CHAT_CATCH_UP_COPY.name}
            </Text>
            <Text style={styles.caption}>
              {scope.channelName ? `#${scope.channelName} · ` : ""}
              {CHAT_CATCH_UP_COPY.private}
            </Text>
          </View>
          {scope.kind === "channel" ? (
            // Never disabled while it works: picking another range replaces
            // the request in flight.
            <Segmented
              accessibilityLabel={CHAT_CATCH_UP_COPY.range_label}
              value={range}
              onChange={onRange}
              options={(scope.unread
                ? (["unread", "day", "week"] as const)
                : (["day", "week"] as const)
              ).map((value) => ({
                value,
                label: CHAT_CATCH_UP_COPY.ranges[value],
              }))}
            />
          ) : null}
          <View accessibilityLiveRegion="polite" style={styles.result}>
            {held?.kind === "consent" ? (
              <Notice
                line={chatCatchUpUnavailableLine("consent_required")}
                action={CHAT_CATCH_UP_COPY.consent_action}
                onAction={onAgain}
                styles={styles}
              />
            ) : held?.kind === "failed" ? (
              <Notice
                line={held.message}
                action={CHAT_CATCH_UP_COPY.try_again}
                onAction={onAgain}
                styles={styles}
              />
            ) : working ? (
              <Text style={styles.working}>{CHAT_CATCH_UP_COPY.working}</Text>
            ) : run?.phase === "failed" ? (
              <Notice
                line={run.failure ?? CHAT_CATCH_UP_COPY.failed}
                action={CHAT_CATCH_UP_COPY.try_again}
                onAction={onAgain}
                styles={styles}
              />
            ) : run?.summary ? (
              <Summary
                // A new summary reads its own "Today".
                key={run.summary.summary_id ?? run.summary.status}
                summary={run.summary}
                nameFor={nameFor}
                onAgain={onAgain}
                onOpenPoint={onOpenPoint}
                report={report}
                styles={styles}
              />
            ) : null}
          </View>
        </BottomSheetScrollView>
      ) : null}
    </BottomSheetModal>
  );
}

type Styles = ReturnType<typeof createStyles>;

/** One line of plain words, and the one thing to do about it. */
function Notice({
  line,
  action,
  onAction,
  children,
  styles,
}: {
  line: string;
  action?: string;
  onAction?: () => void;
  children?: ReactNode;
  styles: Styles;
}) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeLine}>{line}</Text>
      {children}
      {action && onAction ? (
        <QuietButton label={action} onPress={onAction} styles={styles} />
      ) : null}
    </View>
  );
}

function QuietButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // 36pt drawn against the 44pt minimum.
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Notes({ summary, styles }: { summary: ChatCatchUp; styles: Styles }) {
  const notes = chatCatchUpNotes(summary);
  if (notes.length === 0) return null;
  return (
    <View style={styles.notes}>
      {notes.map((note) => (
        <Text key={note} style={styles.caption}>
          {note}
        </Text>
      ))}
    </View>
  );
}

function Summary({
  summary,
  nameFor,
  onOpenPoint,
  onAgain,
  report,
  styles,
}: {
  summary: ChatCatchUp;
  nameFor: (userId: string) => string | null | undefined;
  onOpenPoint: (point: ChatCatchUpPoint) => void;
  onAgain: () => void;
  report: Reporting;
  styles: Styles;
}) {
  // Read once per summary, so every line's "Today" is the same day.
  const [now] = useState(() => new Date());

  if (summary.status === "unavailable") {
    return (
      <Notice
        line={chatCatchUpUnavailableLine(summary.reason)}
        action={
          summary.reason === "consent_required"
            ? CHAT_CATCH_UP_COPY.consent_action
            : undefined
        }
        onAction={onAgain}
        styles={styles}
      />
    );
  }
  if (summary.status === "nothing_new") {
    return <Notice line={CHAT_CATCH_UP_COPY.nothing_new} styles={styles} />;
  }
  if (summary.status === "too_little") {
    return (
      <Notice line={chatCatchUpTooLittleLine(summary)} styles={styles}>
        <Notes summary={summary} styles={styles} />
      </Notice>
    );
  }
  if (summary.status === "refused") {
    return <Notice line={CHAT_CATCH_UP_COPY.refused} styles={styles} />;
  }
  if (summary.status !== "summarized" || summary.points.length === 0) {
    // `not_found`, and any status this build does not know.
    return (
      <Notice
        line={
          summary.status === "not_found"
            ? CHAT_CATCH_UP_COPY.not_found
            : chatCatchUpUnavailableLine(null)
        }
        action={CHAT_CATCH_UP_COPY.try_again}
        onAction={onAgain}
        styles={styles}
      >
        <Notes summary={summary} styles={styles} />
      </Notice>
    );
  }

  // Report this (#4315), on every AI-made surface.
  const target: AiReportTarget | null =
    report.offered && summary.summary_id
      ? {
          subject: "chat_summary",
          subjectId: summary.summary_id,
          receipt: summary.report_receipt ?? null,
        }
      : null;
  const reported = target ? report.isReported(target) : false;

  return (
    <>
      {CHAT_CATCH_UP_POINT_KINDS.map((kind) => {
        const points = summary.points.filter(
          (point) => chatCatchUpGroupOf(point.kind) === kind,
        );
        if (points.length === 0) return null;
        return (
          <View key={kind} style={styles.group}>
            <Text accessibilityRole="header" style={styles.groupHeading}>
              {CHAT_CATCH_UP_COPY.groups[kind]}
            </Text>
            {points.map((point) => {
              const who = point.author_id ? nameFor(point.author_id) : null;
              const when = chatCatchUpWhen(point.sent_at, now);
              const meta = [who, when].filter(Boolean).join(" · ");
              return (
                <Pressable
                  key={`${point.kind}:${point.message_id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${point.text} ${meta}`}
                  accessibilityHint={CHAT_CATCH_UP_COPY.open_message}
                  onPress={() => onOpenPoint(point)}
                  style={({ pressed }) => [
                    styles.point,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={styles.pointText}>{point.text}</Text>
                  {meta ? <Text style={styles.caption}>{meta}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <Notes summary={summary} styles={styles} />
      <View style={styles.foot}>
        <QuietButton
          label={CHAT_CATCH_UP_COPY.again}
          onPress={onAgain}
          styles={styles}
        />
        {target ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action
            }
            accessibilityState={reported ? { disabled: true } : undefined}
            disabled={reported}
            hitSlop={4}
            onPress={() => report.report(target)}
            style={({ pressed }) => [
              styles.report,
              pressed ? styles.pressed : null,
            ]}
          >
            {/* The words change in place, so the row keeps its height. */}
            <Text style={styles.caption}>
              {reported ? AI_REPORT_COPY.reported : AI_REPORT_COPY.action}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

/**
 * The strip under a channel's header: one line, one action, and ×. It says
 * how many messages are new and offers the summary, or, once a line of a
 * summary has been opened, leads back to that summary. At the Important
 * strip's height, in the quiet surface colours, since it is an offer and
 * not an alert.
 */
export function CatchUpStrip({
  line,
  action,
  onAction,
  onDismiss,
}: {
  line: string;
  action: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View testID="catch-up-strip" style={styles.strip}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${line} ${action}`}
        onPress={onAction}
        style={({ pressed }) => [
          styles.stripMain,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text numberOfLines={1} style={styles.stripLine}>
          {line}
        </Text>
        <Text style={styles.stripAction}>{action}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CHAT_CATCH_UP_COPY.offer_dismiss}
        onPress={onDismiss}
        style={({ pressed }) => [
          styles.stripDismiss,
          pressed ? styles.pressed : null,
        ]}
      >
        <CloseGlyph size={16} color={tokens.color.text.mutedForeground} />
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    heading: {
      gap: tokens.spacing.xs,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    result: {
      gap: tokens.spacing.lg,
    },
    working: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    notice: {
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    noticeLine: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    notes: {
      gap: tokens.spacing.xs,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    groupHeading: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    point: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.xs,
    },
    pointText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    foot: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    button: {
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    buttonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    report: {
      height: 36,
      justifyContent: "center",
    },
    strip: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: tokens.touch.minimum,
      backgroundColor: tokens.color.surface.surface1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    stripMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      paddingLeft: tokens.spacing.lg,
      paddingRight: tokens.spacing.sm,
    },
    stripLine: {
      ...caption,
      color: tokens.color.text.mutedForeground,
      flexShrink: 1,
    },
    stripAction: {
      ...caption,
      fontFamily: fontFamilyFor(600),
      color: tokens.color.text.foreground,
      marginLeft: "auto",
    },
    stripDismiss: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { opacity: 0.7 },
  });
}
