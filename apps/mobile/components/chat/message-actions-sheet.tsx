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
import { SignetTokens } from "@repo/theme/signet";
import { ListRow, ListSection } from "@/components/list-section";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  BLOCK_ROW_DESCRIPTION,
  confirmBlockMember,
  UNNAMED_MEMBER,
  useBlockActions,
} from "@/lib/chat/block-actions";
import {
  REPORT_ALREADY_BODY,
  REPORT_ALREADY_TITLE,
  REPORT_FAILED_TITLE,
  REPORT_REASON_OPTIONS,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  reportFailureBody,
} from "@/lib/chat/report-reasons";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The member-safety actions on one message: report it, or block its sender
 * (#2257, App Store Guideline 1.2). Opened by long-pressing someone else's
 * bubble or poll card in s05, or by the "Message actions" accessibility action
 * on either.
 *
 * **Two sheets, not one with panes.** The menu is two rows and sizes to its
 * content; the report form is seven reasons, a text field and a button, which
 * on a small phone with the keyboard up is taller than the screen. A bounded
 * sheet takes `enableDynamicSizing`, and one with a scrollable body takes a
 * fixed detent with the sheet-aware scroll view as its direct child
 * (`spec/ui/mobile/patterns.md` § Bottom sheets) — one sheet cannot be both, so
 * the report form is its own sheet that replaces the menu (gorhom's
 * `stackBehavior="replace"`), where s19 stacks its assignee picker on top.
 *
 * **Which rows show is decided by the caller**, from `messageActionsFor` in
 * `lib/chat/blocks.ts`: this component is never opened on the viewer's own
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

export interface MessageActionsTarget {
  /** Server id — the sheet only opens on confirmed rows. */
  messageId: string;
  /** `users.id` to block; `null` when the sender is not blockable. */
  blockUserId: string | null;
  /** Resolved display name, or `null` when the roster cannot name them. */
  senderName: string | null;
  /**
   * Whether the loaded roster lists the sender, which is what makes the block
   * confirmation's "they stay in the directory" true. `false` whenever it does
   * not — not loaded yet, or not listing them.
   */
  senderInDirectory: boolean;
}

/** What the report form shows once a request has come back. */
type ReportOutcome = "sent" | "already";

/** Says an outcome aloud on iOS, where `accessibilityLiveRegion` does nothing. */
function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

export interface MessageActionsSheetHandle {
  present: () => void;
}

export interface MessageActionsSheetProps {
  target: MessageActionsTarget | null;
  /**
   * A block attempt came back as the API's "not a member of this chapter"
   * (`isMemberNotFound`): the caller can stop offering Block for them.
   */
  onSenderDeparted?: (userId: string) => void;
}

export const MessageActionsSheet = forwardRef<
  MessageActionsSheetHandle,
  MessageActionsSheetProps
>(function MessageActionsSheet({ target, onSenderDeparted }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const menuRef = useRef<BottomSheetModal>(null);
  const reportRef = useRef<BottomSheetModal>(null);

  useImperativeHandle(
    ref,
    () => ({ present: () => menuRef.current?.present() }),
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

  const senderLabel = target?.senderName ?? UNNAMED_MEMBER;
  const canBlock = !!target?.blockUserId;
  const senderInDirectory = target?.senderInDirectory ?? false;

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
      >
        <BottomSheetView style={styles.body}>
          <SheetHeader
            title="Message"
            onCancel={() => menuRef.current?.dismiss()}
          />
          <ListSection>
            <ListRow
              label="Report message"
              description="Your chapter's officers will be able to see it."
              onPress={openReport}
            />
            {canBlock ? (
              <ListRow
                label={`Block ${senderLabel}`}
                description={BLOCK_ROW_DESCRIPTION}
                destructive
                onPress={() => startBlock("menu")}
              />
            ) : null}
          </ListSection>
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
        <BottomSheetScrollView
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
                onCancel={() => reportRef.current?.dismiss()}
                cancelLabel="Done"
              />
              <Text style={styles.bodyText} accessibilityLiveRegion="polite">
                {outcome === "already" ? REPORT_ALREADY_BODY : REPORT_SENT_BODY}
              </Text>
              {canBlock ? (
                <ListSection>
                  <ListRow
                    label={`Block ${senderLabel}`}
                    description={BLOCK_ROW_DESCRIPTION}
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
                title="Report message"
                onCancel={() => reportRef.current?.dismiss()}
              />
              <Text style={styles.caption}>Why are you reporting it?</Text>
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
                label={report.isPending ? "Sending…" : "Send report"}
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

function createStyles(tokens: SignetTokens) {
  const RADIO_SIZE = 20;
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    bodyText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    reasons: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
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
