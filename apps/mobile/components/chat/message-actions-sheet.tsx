import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  CHAT_REPORT_DETAILS_MAX_LENGTH,
  useReportMessage,
  type ChatReportReason,
} from "@repo/hooks";
import { UNNAMED_MEMBER, blockActionLabel } from "@repo/chat-core/block-copy";
import { dayDividerLabel } from "@repo/chat-core/grouping";
import { formatTimeOfDay } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection } from "@/components/list-section";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  SheetBackToClose,
  useSheetClose,
} from "@/components/sheet-scaffold";
import * as Clipboard from "expo-clipboard";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectionHaptic } from "@/lib/haptics";
import {
  BLOCK_ROW_DESCRIPTION,
  confirmBlockMember,
  useBlockActions,
} from "@/lib/chat/block-actions";
import {
  REPORT_ALREADY_BODY,
  REPORT_ALREADY_TITLE,
  REPORT_FAILED_TITLE,
  REPORT_REASON_OPTIONS,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  REPORT_FORM_PROMPT,
  REPORT_FORM_TITLE,
  REPORT_SEND_LABEL,
  reportFailureBody,
} from "@repo/chat-core/report-copy";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The actions on one message: react to it, reply to it, edit or delete it
 * (#2775), and the member-safety pair, report it or block its sender (#2257,
 * App Store Guideline 1.2). Opened by long-pressing a message or card in s05,
 * by the `+` chip after its reactions, or by the "Message actions"
 * accessibility action.
 *
 * **Quick reactions come first.** The thread draws no reaction control on a
 * message nobody has reacted to (`ReactionRow` in `message-item.tsx`), so this
 * row is where the first reaction starts, as it does in every messenger's
 * long-press. The four picks are web's (`QUICK_REACTIONS` in
 * `apps/web/components/chat/reaction-bar.tsx`). One the viewer already used is
 * drawn selected, and tapping it takes the reaction back off, the toggle
 * `spec/behavior/chat/README.md` § Reactions describes. Either way the sheet
 * closes: the chip under the message is the confirmation.
 *
 * **Copy text comes first among the rows**, as in iMessage and Discord: the
 * message's text as written, for a card-free message with a body
 * (`copyableText`). The row turns to "Copied" in place, then the sheet closes.
 *
 * **Reply, Edit and Delete hand off to the thread.** Reply and Edit stage in
 * the composer and Delete asks for confirmation in a native alert, so each row
 * closes the sheet and tells the screen which message it was for.
 *
 * **Two sheets, not one with panes.** The menu is the quick reactions and at
 * most four rows (Reply, Edit and Delete on your own message; Reply, Delete,
 * Report and Block on someone else's) and sizes to its content; the report form is seven reasons, a text field and a button, which
 * on a small phone with the keyboard up is taller than the screen. A bounded
 * sheet takes `enableDynamicSizing`, and one with a scrollable body takes a
 * fixed detent with the sheet-aware scroll view as its direct child
 * (`spec/ui/mobile/patterns.md` § Bottom sheets) — one sheet cannot be both, so
 * the report form is its own sheet that replaces the menu (gorhom's
 * `stackBehavior="replace"`), where s19 stacks its assignee picker on top.
 *
 * **Which rows show is decided by the caller**, from `messageActionsFor` in
 * `@repo/chat-core/message-actions`: Report and Block never show on the viewer's own
 * message, and `canBlock` is false for the system actor, imported rows and a
 * sender a block attempt already proved has left the chapter — never merely
 * because the cached roster does not list them yet.
 *
 * **A failed report says whether trying again can help** (`reportFailureBody`):
 * a 403, 404 or 409 is a permanent refusal, anything else asks for another try.
 *
 * **Every report outcome reaches the member.** On screen while the form is up;
 * as an alert if they dismissed it before a failure came back, the same way a
 * dismissed Block reports its failure; and to VoiceOver through
 * `AccessibilityInfo.announceForAccessibility`, because
 * `accessibilityLiveRegion` is Android-only.
 */

const REPORT_SNAP_POINTS = ["85%"];

/** The Copy text row's label once the text is on the clipboard. */
export const COPIED_LABEL = "Copied";
/** How long "Copied" shows before the sheet closes: long enough to read. */
const COPIED_HOLD_MS = 700;

/**
 * The sheet's quick reactions, in web's order (`QUICK_REACTIONS` in
 * `apps/web/components/chat/reaction-bar.tsx`). A copy rather than a shared
 * export: the list lives in a web component, not in `@repo/chat-core`, so
 * the two must move together until it is hoisted there.
 */
export const QUICK_REACTIONS: readonly string[] = ["👍", "🙏", "✅", "🔥"];

/** A quick reaction's accessible name, by whether it adds or takes back. */
export function quickReactionLabel(emoji: string, mine: boolean): string {
  return mine ? `Remove ${emoji} reaction` : `React with ${emoji}`;
}

export interface MessageActionsTarget {
  /** Server id — the sheet only opens on confirmed rows. */
  messageId: string;
  /**
   * What "Copy text" copies (`copyableText` in `@repo/chat-core`), or `null`
   * for a card, a photo-only message or a deleted one, where the row is not
   * drawn.
   */
  copyText: string | null;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** False on the viewer's own message. */
  canReport: boolean;
  /** `users.id` to block; `null` when the sender is not blockable. */
  blockUserId: string | null;
  /** Resolved display name, or `null` when the roster cannot name them. */
  senderName: string | null;
  /**
   * The row's author label ("You" on the viewer's own), for the header line
   * that says who sent it and when. A follow-on row in a run draws neither on
   * screen (components.md §11), so this is where a phone shows them.
   */
  senderLabel: string;
  /** `created_at`, for the same line. */
  sentAt: string;
  /**
   * Whether the loaded roster lists the sender, which is what makes the block
   * confirmation's "they stay in the directory" true. `false` whenever it does
   * not — not loaded yet, or not listing them.
   */
  senderInDirectory: boolean;
  /**
   * The emoji the viewer has already reacted with on this message, so the
   * quick reactions can draw them selected and take them back on a tap. The
   * caller reads it from the current message on every render, not once at the
   * long-press, so it follows a rollback or another device while the sheet is
   * open.
   */
  reactedWith: readonly string[];
}

/** What the report form shows once a request has come back. */
type ReportOutcome = "sent" | "already";

/** Says an outcome aloud on iOS, where `accessibilityLiveRegion` does nothing. */
function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

export interface MessageActionsSheetHandle {
  present: () => void;
  /** Closes the menu. The report form, once open, is the member's to close. */
  dismiss: () => void;
}

export interface MessageActionsSheetProps {
  target: MessageActionsTarget | null;
  /**
   * A block attempt came back as the API's "not a member of this chapter"
   * (`isMemberNotFound`): the caller can stop offering Block for them.
   */
  onSenderDeparted?: (userId: string) => void;
  /** Stage a reply to this message in the composer. */
  onReply?: (messageId: string) => void;
  /** Start editing this message in the composer. */
  onEdit?: (messageId: string) => void;
  /** Confirm, then delete, this message. */
  onDelete?: (messageId: string) => void;
  /**
   * Add a reaction from the quick row. Omit it, with `onUnreact`, and the row
   * is not drawn.
   */
  onReact?: (messageId: string, emoji: string) => void;
  /** Take back a reaction the viewer already made, from the quick row. */
  onUnreact?: (messageId: string, emoji: string) => void;
}

export const MessageActionsSheet = forwardRef<
  MessageActionsSheetHandle,
  MessageActionsSheetProps
>(function MessageActionsSheet(
  { target, onSenderDeparted, onReply, onEdit, onDelete, onReact, onUnreact },
  ref,
) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const menuRef = useRef<BottomSheetModal>(null);
  const reportRef = useRef<BottomSheetModal>(null);
  const closeMenu = useSheetClose(menuRef);
  const closeReport = useSheetClose(reportRef);

  useImperativeHandle(
    ref,
    () => ({
      present: () => menuRef.current?.present(),
      dismiss: () => menuRef.current?.dismiss(),
    }),
    [],
  );

  const report = useReportMessage();
  const { block } = useBlockActions();

  const [reason, setReason] = useState<ChatReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [outcome, setOutcome] = useState<ReportOutcome | null>(null);
  /** What the last failed report said (`reportFailureBody`), or `null`. */
  const [failed, setFailed] = useState<string | null>(null);

  // A new target is a new form. Reset during render rather than in an effect
  // (React's "adjusting state when a prop changes" pattern), so the next
  // message never opens on the last one's reason or its "Report sent".
  const targetMessageId = target?.messageId ?? null;
  const [formFor, setFormFor] = useState(targetMessageId);
  if (formFor !== targetMessageId) {
    setFormFor(targetMessageId);
    setReason(null);
    setDetails("");
    setOutcome(null);
    setFailed(null);
  }

  /**
   * The message a report request was sent for, and the message the sheet is
   * on now. A request still in flight when the member dismisses and opens
   * another message's sheet must not mark *that* one sent — the same
   * stale-completion guard `use-chat-channel.ts` puts on its error sinks. The
   * second is mirrored in an effect because refs cannot be written in render.
   * A result that is no longer current is not dropped: a failure becomes an
   * alert (see the component doc).
   */
  const inFlightFor = useRef<string | null>(null);
  const currentTargetRef = useRef(targetMessageId);
  useEffect(() => {
    currentTargetRef.current = targetMessageId;
  }, [targetMessageId]);
  const isCurrent = useCallback(
    (messageId: string) =>
      inFlightFor.current === messageId &&
      currentTargetRef.current === messageId,
    [],
  );

  /**
   * Which message's text was just copied. "Copy text" confirms in place: the
   * row reads "Copied" with a tick of haptics, then the sheet closes, so the
   * member sees it worked without a toast landing over the thread.
   */
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  /**
   * However the menu closed (the timer, a swipe, Android back, another row),
   * the next open starts on "Copy text", and a timer still pending can't
   * close a sheet the member has opened since.
   */
  const resetCopy = useCallback(() => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = null;
    setCopiedFor(null);
  }, []);
  const copyText = useCallback(() => {
    const text = target?.copyText;
    const messageId = target?.messageId;
    if (!text || !messageId) return;
    void Clipboard.setStringAsync(text)
      .then(() => {
        selectionHaptic();
        setCopiedFor(messageId);
        announce(COPIED_LABEL);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => {
          copyTimer.current = null;
          menuRef.current?.dismiss();
        }, COPIED_HOLD_MS);
      })
      .catch(() => {
        Alert.alert("Couldn't copy", "Try again in a moment.");
      });
  }, [target]);

  const senderLabel = target?.senderName ?? UNNAMED_MEMBER;
  const canBlock = !!target?.blockUserId;
  const senderInDirectory = target?.senderInDirectory ?? false;

  /** Closes the menu, then hands the message to the thread. */
  const handOff = useCallback(
    (run: ((messageId: string) => void) | undefined) => {
      const messageId = target?.messageId;
      menuRef.current?.dismiss();
      if (messageId && run) run(messageId);
    },
    [target],
  );

  /** Closes the menu, then adds the reaction, or takes back one already made. */
  const pickReaction = useCallback(
    (emoji: string, mine: boolean) => {
      const messageId = target?.messageId;
      menuRef.current?.dismiss();
      if (!messageId) return;
      if (mine) onUnreact?.(messageId, emoji);
      else onReact?.(messageId, emoji);
    },
    [onReact, onUnreact, target],
  );

  // The report sheet's `stackBehavior="replace"` dismisses the menu as it
  // mounts, so closing the form returns to the thread, not to the menu.
  const openReport = useCallback(() => {
    reportRef.current?.present();
  }, []);

  const startBlock = useCallback(
    (sheet: "menu" | "report") => {
      const userId = target?.blockUserId;
      if (!userId) return;
      confirmBlockMember({
        name: target?.senderName ?? null,
        inDirectory: senderInDirectory,
        run: () => block(userId),
        onDone: () =>
          (sheet === "menu" ? menuRef : reportRef).current?.dismiss(),
        onNotAMember: () => onSenderDeparted?.(userId),
      });
    },
    [block, onSenderDeparted, senderInDirectory, target],
  );

  const submitReport = useCallback(() => {
    if (!target || !reason) return;
    const messageId = target.messageId;
    inFlightFor.current = messageId;
    setFailed(null);
    void (async () => {
      let result: ReportOutcome;
      try {
        const filed = await report.mutateAsync({ messageId, reason, details });
        result = filed.alreadyReported ? "already" : "sent";
      } catch (error) {
        const body = reportFailureBody(error);
        if (isCurrent(messageId)) {
          setFailed(body);
          announce(body);
        } else {
          // Dismissed, or moved to another message, before the failure came
          // back. Dropping it would leave the member believing the report
          // went through.
          Alert.alert(REPORT_FAILED_TITLE, body);
        }
        return;
      }
      if (!isCurrent(messageId)) return;
      setOutcome(result);
      announce(result === "already" ? REPORT_ALREADY_BODY : REPORT_SENT_TITLE);
    })();
  }, [details, isCurrent, reason, report, target]);

  const resetReport = useCallback(() => {
    inFlightFor.current = null;
    setReason(null);
    setDetails("");
    setOutcome(null);
    setFailed(null);
  }, []);

  return (
    <>
      <BottomSheetModal
        ref={menuRef}
        enableDynamicSizing
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onDismiss={resetCopy}
      >
        <SheetBackToClose onClose={closeMenu} />
        <BottomSheetView onAccessibilityEscape={closeMenu} style={styles.body}>
          {/* No title and no Cancel: this is a menu of actions, not a form.
              The line naming the message is its heading, and the grabber,
              the scrim, Android back and VoiceOver's escape close it
              (components.md § Chrome weight). Its rows act in place, so they
              carry no chevron. */}
          {target ? (
            <Text style={styles.sentLine} numberOfLines={1}>
              {`${target.senderLabel} · ${sentAtLabel(target.sentAt)}`}
            </Text>
          ) : null}
          {target && onReact && onUnreact ? (
            <View style={styles.reactions}>
              {QUICK_REACTIONS.map((emoji) => {
                const mine = target.reactedWith.includes(emoji);
                return (
                  <Pressable
                    key={emoji}
                    accessibilityRole="button"
                    accessibilityLabel={quickReactionLabel(emoji, mine)}
                    accessibilityState={{ selected: mine }}
                    onPress={() => pickReaction(emoji, mine)}
                    style={({ pressed }) => [
                      styles.reaction,
                      mine
                        ? {
                            backgroundColor: accentSubtle,
                            borderColor: accentBorder,
                          }
                        : null,
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {target?.copyText ||
          target?.canReply ||
          target?.canEdit ||
          target?.canDelete ? (
            <ListSection>
              {target.copyText ? (
                <ListRow
                  label={
                    copiedFor === target.messageId ? COPIED_LABEL : "Copy text"
                  }
                  action
                  onPress={copyText}
                />
              ) : null}
              {target.canReply ? (
                <ListRow
                  label="Reply"
                  action
                  onPress={() => handOff(onReply)}
                />
              ) : null}
              {target.canEdit ? (
                <ListRow
                  label="Edit message"
                  action
                  onPress={() => handOff(onEdit)}
                />
              ) : null}
              {target.canDelete ? (
                <ListRow
                  label="Delete message"
                  action
                  destructive
                  onPress={() => handOff(onDelete)}
                />
              ) : null}
            </ListSection>
          ) : null}
          {target?.canReport ? (
            <ListSection>
              <ListRow
                label={REPORT_FORM_TITLE}
                description="Your chapter's officers will be able to see it."
                onPress={openReport}
              />
              {canBlock ? (
                <ListRow
                  label={blockActionLabel(senderLabel)}
                  description={BLOCK_ROW_DESCRIPTION}
                  action
                  destructive
                  onPress={() => startBlock("menu")}
                />
              ) : null}
            </ListSection>
          ) : null}
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={reportRef}
        stackBehavior="replace"
        enableDynamicSizing={false}
        snapPoints={REPORT_SNAP_POINTS}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onDismiss={resetReport}
      >
        <SheetBackToClose onClose={closeReport} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeReport}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {outcome ? (
            <>
              <SheetHeader
                title={
                  outcome === "already"
                    ? REPORT_ALREADY_TITLE
                    : REPORT_SENT_TITLE
                }
              />
              <Text style={styles.bodyText} accessibilityLiveRegion="polite">
                {outcome === "already" ? REPORT_ALREADY_BODY : REPORT_SENT_BODY}
              </Text>
              {canBlock ? (
                <ListSection>
                  <ListRow
                    label={blockActionLabel(senderLabel)}
                    description={BLOCK_ROW_DESCRIPTION}
                    action
                    destructive
                    onPress={() => startBlock("report")}
                  />
                </ListSection>
              ) : null}
              <SheetPrimaryButton
                label="Done"
                onPress={() => reportRef.current?.dismiss()}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </>
          ) : (
            <>
              <SheetHeader
                title={REPORT_FORM_TITLE}
                onCancel={() => reportRef.current?.dismiss()}
              />
              <Text style={styles.caption}>{REPORT_FORM_PROMPT}</Text>
              <View accessibilityRole="radiogroup" style={styles.reasons}>
                {REPORT_REASON_OPTIONS.map((option) => {
                  const selected = option.reason === reason;
                  return (
                    <Pressable
                      key={option.reason}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={option.label}
                      onPress={() => setReason(option.reason)}
                      style={({ pressed }) => [
                        styles.reasonRow,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.radio,
                          selected ? { borderColor: accent } : null,
                        ]}
                      >
                        {selected ? (
                          <View
                            style={[
                              styles.radioDot,
                              { backgroundColor: accent },
                            ]}
                          />
                        ) : null}
                      </View>
                      <Text style={styles.reasonLabel}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <BottomSheetTextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Add details (optional)"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Details, optional"
                maxLength={CHAT_REPORT_DETAILS_MAX_LENGTH}
                multiline
                style={styles.details}
              />
              {failed ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {failed}
                </Text>
              ) : null}
              <SheetPrimaryButton
                label={report.isPending ? "Sending…" : REPORT_SEND_LABEL}
                onPress={submitReport}
                disabled={!reason || report.isPending || !target}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheetModal>
    </>
  );
});

/**
 * "Today at 5:16 PM", "Sunday, Sep 28 at 9:41 PM": the day as the thread's
 * divider names it, then the time. The only place a phone shows a follow-on
 * row's time.
 */
export function sentAtLabel(sentAt: string): string {
  const day = dayDividerLabel(sentAt);
  const time = formatTimeOfDay(sentAt);
  return day && time ? `${day} at ${time}` : time;
}

function createStyles(tokens: SignetTokens) {
  const RADIO_SIZE = 20;
  return StyleSheet.create({
    sentLine: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    // Four equal 44pt cells across the sheet, in the ListSection's surface
    // recipe so the row reads as part of the same menu. A selected one swaps
    // in the chapter's quiet fill and border at render, the reacted chip's
    // recipe under the message (components.md §11).
    reactions: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    reaction: {
      flex: 1,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      alignItems: "center",
      justifyContent: "center",
    },
    reactionEmoji: {
      ...typeRole(tokens.typography.role.title),
    },
    bodyText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    reasons: {
      // The ListSection recipe, so the reasons read as the same grouped list.
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      overflow: "hidden",
    },
    reasonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
    },
    radio: {
      width: RADIO_SIZE,
      height: RADIO_SIZE,
      borderRadius: RADIO_SIZE / 2,
      borderWidth: 2,
      borderColor: tokens.color.border.input,
      alignItems: "center",
      justifyContent: "center",
    },
    radioDot: {
      width: RADIO_SIZE / 2,
      height: RADIO_SIZE / 2,
      borderRadius: RADIO_SIZE / 4,
    },
    reasonLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    details: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      minHeight: 88,
      textAlignVertical: "top",
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
