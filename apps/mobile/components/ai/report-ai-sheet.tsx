import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import { useAiReportPolicy, useMyPermissions, useReportAi } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_REPORT_COPY,
  AI_REPORT_NOTE_MAX_LENGTH,
  AI_REPORT_REASONS,
  aiReportAttachedLine,
  can,
  type AiReportReason,
  type AiReportSubject,
} from "@repo/validation";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * "Report this" on the phone, for anything the AI made: an Ask answer, a
 * drafted set of minutes, a suggested task (#4315, `spec/behavior/ai.md`
 * § Stored AI text). Web's twin is `apps/web/components/ai/report-ai.tsx`,
 * and both read the same words and reasons (`AI_REPORT_COPY`).
 *
 * It follows what a member already knows from reporting a message here (the
 * message menu's report form) and from the thumbs-down on a ChatGPT or
 * Gemini answer: a few reasons, an optional note, one Send. Unlike those, it
 * says before Send exactly what goes with the report, who reads it and for
 * how long, because a report is the one place Frapp keeps AI text.
 */

/** What is being reported. */
export interface AiReportTarget {
  subject: AiReportSubject;
  /** The ask's id, the meeting's id (for its draft), or the suggestion's id. */
  subjectId: string;
  /** Ask only: the answer's `report_receipt`, exactly as it came. */
  receipt?: string | null;
  /**
   * Tells one thing from the next under the same id: each draft of a
   * meeting's minutes is its own thing to report.
   */
  version?: string | null;
}

type Outcome = "sent" | "already";

const SNAP_POINTS = ["85%"];
const RADIO_SIZE = 20;

const keyOf = (target: AiReportTarget) =>
  `${target.subject}:${target.subjectId}:${target.version ?? ""}`;

function failureLine(error: unknown): string {
  const code = codeOf(error);
  if (code === "ai.report.too_old") return AI_REPORT_COPY.too_old;
  if (code === "ai.report.receipt_invalid") {
    return AI_REPORT_COPY.receipt_invalid;
  }
  if (code === "ai.report.not_found") return AI_REPORT_COPY.gone;
  return AI_REPORT_COPY.failed;
}

export interface ReportAiSheetProps {
  /** What the sheet reports; null before anything has been picked. */
  target: AiReportTarget | null;
  /** The server has the report, new or already there. */
  onReported: (target: AiReportTarget) => void;
}

export const ReportAiSheet = forwardRef<BottomSheetModal, ReportAiSheetProps>(
  function ReportAiSheet({ target, onReported }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens, accent);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, visit, isSameVisit } = useSheetVisit(ref);
    const policy = useAiReportPolicy({ enabled: target !== null });
    const report = useReportAi();
    const [reason, setReason] = useState<AiReportReason | null>(null);
    const [note, setNote] = useState("");
    const [focused, setFocused] = useState(false);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    // An answer from a server with no key carries no receipt; neither keeps
    // the text, and the sheet says so. Until the server has said, the line
    // keeps its place and Send waits, so a member never confirms unseen. If
    // the server's answer can't be read, the sheet says the most a report
    // could keep, so a member never sends more than they were told.
    const serverKeeps = policy.data
      ? policy.data.keeps_text
      : policy.isError || policy.data === null
        ? true
        : null;
    const keepsText =
      !target || serverKeeps === null
        ? null
        : serverKeeps && (target.subject !== "ask_answer" || !!target.receipt);

    const submit = useCallback(async () => {
      if (!target || !reason || report.isPending || keepsText === null) return;
      setFailure(null);
      const sentFrom = visit();
      try {
        const filed = await report.mutateAsync({
          subject: target.subject,
          subjectId: target.subjectId,
          reason,
          note,
          receipt: target.receipt ?? null,
        });
        // The report is in whether or not the sheet is still up.
        onReported(target);
        if (isSameVisit(sentFrom)) {
          setOutcome(filed.already_reported ? "already" : "sent");
        }
      } catch (error) {
        if (isSameVisit(sentFrom)) setFailure(failureLine(error));
      }
    }, [isSameVisit, keepsText, note, onReported, reason, report, target, visit]);

    return (
      <BottomSheetModal
        ref={ref}
        stackBehavior={SHEET_STACK_BEHAVIOR}
        enableDynamicSizing={false}
        snapPoints={SNAP_POINTS}
        keyboardBehavior="interactive"
        // Held while the report is out, like the message report: closing
        // would throw the answer away, and a failure would reach no one.
        enablePanDownToClose={!report.isPending}
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={() => {
          markClosed();
          // The next thing reported never opens on this one's reason.
          setReason(null);
          setNote("");
          setOutcome(null);
          setFailure(null);
        }}
      >
        <SheetBackToClose onClose={closeSheet} />
        <BottomSheetScrollView
          onAccessibilityEscape={closeSheet}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {outcome ? (
            <>
              <SheetHeader
                title={
                  outcome === "already"
                    ? AI_REPORT_COPY.already_title
                    : AI_REPORT_COPY.sent_title
                }
              />
              <Text style={styles.text} accessibilityLiveRegion="polite">
                {outcome === "already"
                  ? AI_REPORT_COPY.already_body
                  : AI_REPORT_COPY.sent_body}
              </Text>
              <SheetPrimaryButton
                label={AI_REPORT_COPY.done}
                onPress={closeSheet}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </>
          ) : (
            <>
              <SheetHeader
                title={
                  target
                    ? AI_REPORT_COPY.titles[target.subject]
                    : AI_REPORT_COPY.action
                }
                onCancel={closeSheet}
                cancelLabel={AI_REPORT_COPY.cancel}
                cancelDisabled={report.isPending}
              />
              <Text style={styles.text}>{AI_REPORT_COPY.who_reads}</Text>
              <Text style={styles.caption}>{AI_REPORT_COPY.prompt}</Text>
              <View accessibilityRole="radiogroup" style={styles.reasons}>
                {AI_REPORT_REASONS.map((option) => {
                  const selected = option === reason;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: report.isPending,
                      }}
                      accessibilityLabel={AI_REPORT_COPY.reasons[option]}
                      disabled={report.isPending}
                      onPress={() => setReason(option)}
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
                      <Text style={styles.reasonLabel}>
                        {AI_REPORT_COPY.reasons[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <BottomSheetTextInput
                multiline
                value={note}
                editable={!report.isPending}
                onChangeText={setNote}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={AI_REPORT_COPY.note_label}
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel={AI_REPORT_COPY.note_label}
                maxLength={AI_REPORT_NOTE_MAX_LENGTH}
                style={[
                  styles.field,
                  styles.fieldMultilineText,
                  styles.note,
                  focused ? styles.fieldFocused : null,
                ]}
              />
              {/* What goes with it, said before Send, and why a send failed
                  in the same place. It holds its height while the server
                  answers, so Send never moves under a thumb. */}
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.attached, failure ? styles.problem : null]}
              >
                {failure ??
                  (target && keepsText !== null
                    ? aiReportAttachedLine(target.subject, keepsText)
                    : "")}
              </Text>
              <SheetPrimaryButton
                label={AI_REPORT_COPY.send}
                busy={report.isPending}
                disabled={!reason || report.isPending || keepsText === null}
                onPress={() => void submit()}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </>
          )}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

/**
 * For a surface that shows something the AI made: render `reportSheet` once,
 * and draw a "Report this" action that calls `report(target)`.
 *
 * `offered` is false for a member without `ai:use`, which the report route
 * asks for as Ask does (and until their permissions are known), so nobody is
 * offered a report that could never send. `isReported` holds for as long as
 * the surface is mounted, so the action can read "Reported" in its place.
 */
export function useAiReport(): {
  offered: boolean;
  isReported: (target: AiReportTarget) => boolean;
  report: (target: AiReportTarget) => void;
  reportSheet: ReactNode;
} {
  const permissions = useMyPermissions().data?.permissions;
  const offered = Array.isArray(permissions) && can("ai:use", permissions);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [target, setTarget] = useState<AiReportTarget | null>(null);
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  // Presented once the sheet has the target it was asked to report.
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current || !target) return;
    asked.current = false;
    sheetRef.current?.present();
  }, [target]);

  const report = useCallback((next: AiReportTarget) => {
    asked.current = true;
    // A new object each time, so reporting the same thing again after a
    // failure presents again.
    setTarget({ ...next });
  }, []);
  const onReported = useCallback((done: AiReportTarget) => {
    setReported((previous) => new Set(previous).add(keyOf(done)));
  }, []);
  const isReported = useCallback(
    (candidate: AiReportTarget) => reported.has(keyOf(candidate)),
    [reported],
  );

  return {
    offered,
    isReported,
    report,
    reportSheet: offered ? (
      <ReportAiSheet ref={sheetRef} target={target} onReported={onReported} />
    ) : null,
  };
}

function createStyles(tokens: SignetTokens, accent: string) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    text: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    reasons: {
      // The ListSection recipe, so the reasons read as the same grouped list
      // the message report draws.
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
    note: {
      minHeight: 72,
    },
    attached: {
      ...caption,
      // Four lines whichever words it holds, so Send keeps its place.
      minHeight: (caption.lineHeight ?? 18) * 4,
      color: tokens.color.text.mutedForeground,
    },
    problem: {
      color: tokens.color.semantic.destructiveText,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
