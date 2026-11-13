import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { errorCopy } from "@repo/hooks/error-copy";
import { TASK_ACTION_LABELS } from "@repo/hooks";
import {
  TASK_SEND_BACK_REASON_MAX,
  TASK_SEND_BACK_REASON_MISSING,
  type TaskProofKind,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { Toggle } from "@/components/toggle";
import { useChapterBranding } from "@/lib/chapter-branding";
import { taskStatusGateRefusal } from "@/lib/tasks/status-refusal";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** What Send back sends (#4635). */
export interface SendBackInput {
  comment: string;
  require_photo?: boolean;
}

/**
 * The reason Send back is refused before it sends, or `null` when it can
 * go: the server requires one line (#4635).
 */
export function sendBackProblem(reason: string): string | null {
  return reason.trim() ? null : TASK_SEND_BACK_REASON_MISSING;
}

/**
 * An officer's Send back on the phone (#4635), web's `SendBackDialog` as a
 * sheet: a required one-line reason with a counter, which stays on the task
 * for its assignee, and "Ask for a photo next time" on a task that doesn't
 * already ask for one, the way an Asana approval's "Request changes" and
 * Canvas's resubmission ask for a comment.
 *
 * The host mounts one per Send back (`key` on the task); it opens itself and
 * calls `onClosed` once it has gone. A refusal stays on the sheet with the
 * reason kept.
 */
export function SendBackSheet({
  title,
  proofKind,
  onSubmit,
  onClosed,
}: {
  title: string;
  proofKind: TaskProofKind;
  /** Makes the write. Rejects with the server's error. */
  onSubmit: (input: SendBackInput) => Promise<void>;
  onClosed: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const ref = useRef<BottomSheetModal>(null);
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  const [reason, setReason] = useState("");
  const [askPhoto, setAskPhoto] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    ref.current?.present();
  }, []);

  const submit = async () => {
    if (sending.current) return;
    const refused = sendBackProblem(reason);
    if (refused) {
      setProblem(refused);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const sentFrom = visit();
    try {
      await onSubmit({
        comment: reason.trim(),
        ...(askPhoto && proofKind !== "photo" ? { require_photo: true } : {}),
      });
      if (isSameVisit(sentFrom)) dismiss();
    } catch (error) {
      if (isSameVisit(sentFrom)) {
        setProblem(
          taskStatusGateRefusal(error) ??
            errorCopy(error, "Couldn't send it back. Try again.", {
              serverWritesForMembers: true,
            }),
        );
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={() => {
        markClosed();
        onClosed();
      }}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader
          title={TASK_ACTION_LABELS.reject}
          onCancel={() => dismiss()}
          cancelDisabled={busy}
        />
        <Text style={styles.subtitle}>
          {title} goes back to its assignee with your reason.
        </Text>

        <View style={styles.group}>
          <Text style={styles.label}>What needs to change</Text>
          <View style={[styles.ring, focused ? styles.ringActive : null]}>
            <BottomSheetTextInput
              value={reason}
              onChangeText={setReason}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              editable={!busy}
              autoFocus
              placeholder="The floor is still sticky"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="What needs to change"
              maxLength={TASK_SEND_BACK_REASON_MAX}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
              style={[styles.field, focused ? styles.fieldFocused : null]}
            />
          </View>
          <Text style={styles.counter}>
            {reason.length}/{TASK_SEND_BACK_REASON_MAX}
          </Text>
        </View>

        {proofKind !== "photo" ? (
          <View style={styles.toggleRow}>
            <Text style={styles.label}>Ask for a photo next time</Text>
            <Toggle
              value={askPhoto}
              onValueChange={setAskPhoto}
              accessibilityLabel="Ask for a photo next time"
              disabled={busy}
            />
          </View>
        ) : null}

        {problem ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={TASK_ACTION_LABELS.reject}
          onPress={() => void submit()}
          disabled={busy}
          busy={busy}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fields = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    ring: fields.ring,
    ringActive: fields.ringActive,
    field: fields.field,
    fieldFocused: fields.fieldFocused,
    counter: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      alignSelf: "flex-end",
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
