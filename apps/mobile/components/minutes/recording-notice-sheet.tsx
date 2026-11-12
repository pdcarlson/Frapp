import { forwardRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { MEETING_RECORDER_NOTICE } from "@repo/validation";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The notice an officer reads out before the phone records a meeting
 * (`spec/behavior/meetings.md` § Recording notice). Recording can't start
 * any other way: Record on the minutes screen opens this, and only Start
 * recording here, with the box ticked, opens the microphone.
 *
 * It is the upload step's notice (`recording-upload.tsx` on the web) said
 * before the fact: the same rule, the same script to read aloud, the same
 * Standards line, and one tick. Otter and the iPhone's own call recording
 * both announce a recording to the room before it starts; here the officer
 * does it, because the phone on the table has no voice.
 */
export const RecordingNoticeSheet = forwardRef<
  BottomSheetModal,
  {
    /** The longest recording the server takes. */
    maxSeconds: number;
    /** The officer ticked the box and tapped Start recording. */
    onStart: () => void;
  }
>(function RecordingNoticeSheet({ maxSeconds, onStart }, ref) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const [told, setTold] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function handleStart() {
    if (!told) {
      setProblem(MEETING_RECORDER_NOTICE.unconfirmed);
      return;
    }
    closeSheet();
    onStart();
  }

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      // Each meeting is told afresh: the tick never carries over.
      onDismiss={() => {
        setTold(false);
        setProblem(null);
      }}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
      >
        <Text accessibilityRole="header" style={styles.title}>
          {MEETING_RECORDER_NOTICE.heading}
        </Text>
        <Text style={styles.text}>{MEETING_RECORDER_NOTICE.rule}</Text>

        <View style={styles.script}>
          <Text style={styles.caption}>
            {MEETING_RECORDER_NOTICE.scriptLabel}
          </Text>
          <Text style={styles.scriptText}>{MEETING_RECORDER_NOTICE.script}</Text>
        </View>

        <Text style={styles.caption}>
          {MEETING_RECORDER_NOTICE.whatHappens}{" "}
          {MEETING_RECORDER_NOTICE.standards}
        </Text>
        <Text style={styles.caption}>
          {MEETING_RECORDER_NOTICE.limit(maxSeconds)}
        </Text>

        <OnboardingPressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: told }}
          accessibilityLabel={MEETING_RECORDER_NOTICE.confirmLabel}
          onPress={() => {
            setTold((value) => !value);
            setProblem(null);
          }}
          quiet
          style={styles.confirm}
        >
          <View style={[styles.checkbox, told ? styles.checkboxOn : null]}>
            {told ? (
              <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
                <Path
                  d="M3.5 8.5l3 3 6-7"
                  stroke={tokens.color.gold.onHouse}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </View>
          <Text style={styles.confirmLabel}>
            {MEETING_RECORDER_NOTICE.confirmLabel}
          </Text>
        </OnboardingPressable>

        {/* Always there, so an unticked Start moves nothing. */}
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem ?? ""}
        </Text>

        <SheetPrimaryButton
          label={MEETING_RECORDER_NOTICE.start}
          onPress={handleStart}
          accent={accent}
          onAccent={accentOnPrimary}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  const caption = typeRole(tokens.typography.role.caption);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
      gap: tokens.spacing.md,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    text: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    caption: {
      ...caption,
      color: tokens.color.text.mutedForeground,
    },
    script: {
      gap: tokens.spacing.xs,
      padding: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    scriptText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    confirm: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    checkbox: {
      width: 24,
      height: 24,
      // components.md § Checkbox's 7; no radius token holds it.
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: tint(tokens.color.text.foreground, 0.25),
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxOn: {
      backgroundColor: tokens.color.gold.house,
      borderColor: tokens.color.gold.house,
    },
    confirmLabel: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    problem: {
      ...caption,
      minHeight: (caption.lineHeight ?? 18) * 2,
      color: tokens.color.semantic.destructiveText,
    },
  });
}
