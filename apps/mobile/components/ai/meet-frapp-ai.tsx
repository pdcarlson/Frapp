import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import * as WebBrowser from "expo-web-browser";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { errorCopy, shouldMeetFrappAi, useFrappAiChoice } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  FRAPP_AI_COPY,
  joinNames,
  type FrappAiPoint,
} from "@repo/validation";
import { ChatGlyph, TasksGlyph } from "@/components/tab-glyphs";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { PRIVACY_LINK } from "@/lib/more/legal";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * Meet Frapp AI on the phone (#4790, Paul 2026-11-13): the one screen where
 * a member turns Frapp AI on (`spec/behavior/ai.md` § Consent).
 *
 * Three lines of what it does, one line naming the companies it works with
 * and saying that Continue turns it on, with the privacy policy one tap
 * away. A gold Continue, and a quiet underlined Not now under it, as the
 * notifications step draws its two answers (`push-ask.tsx`): it is
 * encouraged, not forced. The line above the buttons is what makes Continue
 * an explicit yes under Apple 5.1.2(i).
 *
 * The same body and buttons are drawn in four places:
 *
 * - **Onboarding**, as a beat of s03 for a member who joined and of chapter
 *   setup for the officer who created the chapter ({@link useMeetFrappAiStep}).
 * - **Once on next open**, for an account that never answered
 *   (`meet-frapp-ai-host.tsx`).
 * - **At an AI entry point** for a member who chose Not now
 *   ({@link useAiConsentGate}), as a sheet over the feature.
 * - **Settings**, when the Frapp AI switch is turned on.
 *
 * Signet gold, not the chapter accent, as the notifications step: Frapp is
 * asking on its own behalf.
 */

const POINT_GLYPHS: Record<FrappAiPoint["key"], (color: string) => ReactNode> =
  {
    ask: (color) => <SparkGlyph color={color} />,
    catch_up: (color) => <ChatGlyph focused accent={color} muted={color} />,
    nudge: (color) => <TasksGlyph focused accent={color} muted={color} />,
  };

/** The screen's body: the three lines, and the one that names the companies. */
export function MeetFrappAiBody({
  providers,
  forChapter,
  error,
}: {
  providers: readonly string[];
  forChapter: boolean;
  /** Why a Continue didn't save, in the disclosure's place under it. */
  error?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const gold = tokens.color.gold.askText;
  return (
    <View style={styles.body}>
      <View style={styles.card}>
        {FRAPP_AI_COPY.points.map((point, index) => (
          <View key={point.key}>
            {index > 0 ? <View style={styles.rule} /> : null}
            <View style={styles.row}>
              {POINT_GLYPHS[point.key](gold)}
              <Text style={styles.rowLabel}>{point.text}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.disclosure}>
        {FRAPP_AI_COPY.disclosure(joinNames(providers), forChapter)}{" "}
        <Text
          accessibilityRole="link"
          style={styles.link}
          onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_LINK.url)}
        >
          {FRAPP_AI_COPY.privacyLink}
        </Text>
      </Text>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The two answers, for the host's pinned footer: a gold Continue, and Not now
 * as a quiet underlined line under it.
 */
export function MeetFrappAiActions({
  busy,
  disabled = false,
  onContinue,
  onNotNow,
}: {
  busy: boolean;
  disabled?: boolean;
  onContinue: () => void;
  onNotNow: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <>
      <OnboardingPrimaryButton
        label={FRAPP_AI_COPY.continue}
        onPress={onContinue}
        disabled={busy || disabled}
        busy={busy}
      />
      <OnboardingPressable
        accessibilityRole="button"
        onPress={onNotNow}
        disabled={busy || disabled}
        quiet
        style={styles.quietButton}
      >
        <Text style={styles.quietButtonText}>{FRAPP_AI_COPY.notNow}</Text>
      </OnboardingPressable>
    </>
  );
}

/**
 * The screen as a beat of an onboarding flow (s03, chapter setup). `show` is
 * true once the server is known to have AI and the member has never
 * answered, or when their Continue would also turn on a chapter whose
 * switches were never set (a founder who already said yes on another
 * chapter still gets the choice for this one); `settled` once that is known
 * either way, so the host can decide its beats. Continue turns it on; Not now records a No. Either answer moves
 * on: a save that fails on Not now is left for the next open to ask again,
 * and one that fails on Continue keeps the member here with the reason.
 */
export function useMeetFrappAiStep(options?: { includeChapter?: boolean }) {
  const choice = useFrappAiChoice(options);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  const turnOn = useCallback(async (): Promise<boolean> => {
    setError(null);
    setAnswering(true);
    try {
      await choice.turnOn();
      return true;
    } catch (failure) {
      setError(errorCopy(failure, FRAPP_AI_COPY.saveFailed));
      return false;
    } finally {
      setAnswering(false);
    }
  }, [choice]);

  const notNow = useCallback(async (): Promise<void> => {
    setError(null);
    setAnswering(true);
    try {
      // A member who already said yes is here only for the chapter's
      // switches: Not now leaves those off and keeps their own yes.
      if (choice.consent?.answer !== "yes") await choice.notNow();
    } catch {
      // Unanswered still: the next open asks once more.
    } finally {
      setAnswering(false);
    }
  }, [choice]);

  return {
    settled:
      choice.consentFailed ||
      (choice.consent !== undefined && choice.chapterSettled),
    show:
      shouldMeetFrappAi(choice.consent) ||
      (!!choice.consent && choice.forChapter),
    providers: choice.providers,
    forChapter: choice.forChapter,
    error,
    answering,
    turnOn,
    notNow,
  };
}

export interface MeetFrappAiSheetProps {
  /** Called once the server has the answer: true for Continue. */
  onAnswered?: (on: boolean) => void;
  /** The sheet closed, however it closed. */
  onClosed?: () => void;
}

/**
 * Meet Frapp AI as a sheet, over an AI feature or over the chat home. Its
 * title, body and two answers are the onboarding beat's. Swiping it away is
 * not an answer.
 */
export const MeetFrappAiSheet = forwardRef<
  BottomSheetModal,
  MeetFrappAiSheetProps
>(function MeetFrappAiSheet({ onAnswered, onClosed }, ref) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  const choice = useFrappAiChoice();
  const [error, setError] = useState<string | null>(null);
  // Which answer was pressed, so only Continue shows it is saving.
  const [pending, setPending] = useState<"on" | "off" | null>(null);
  // The sheet can be swiped away while an answer is saving. Its close is
  // reported only once the save has ended, after the answer if there is
  // one, so a Continue on its way is never reported as "closed, no answer".
  const saving = useRef(false);
  const closedWhileSaving = useRef(false);

  const submit = useCallback(
    async (on: boolean) => {
      if (pending !== null) return;
      setError(null);
      setPending(on ? "on" : "off");
      saving.current = true;
      const sentFrom = visit();
      try {
        if (on) await choice.turnOn();
        else await choice.notNow();
        onAnswered?.(on);
        if (isSameVisit(sentFrom)) dismiss();
      } catch (failure) {
        if (isSameVisit(sentFrom)) {
          setError(errorCopy(failure, FRAPP_AI_COPY.saveFailed));
        }
      } finally {
        saving.current = false;
        setPending(null);
        if (closedWhileSaving.current) {
          closedWhileSaving.current = false;
          onClosed?.();
        }
      }
    },
    [choice, dismiss, isSameVisit, onAnswered, onClosed, pending, visit],
  );

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={() => {
        markClosed();
        setError(null);
        if (saving.current) closedWhileSaving.current = true;
        else onClosed?.();
      }}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.sheetBody}
      >
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {FRAPP_AI_COPY.title}
        </Text>
        <MeetFrappAiBody
          providers={choice.providers}
          forChapter={choice.forChapter}
          error={error}
        />
        <View style={styles.sheetActions}>
          <MeetFrappAiActions
            busy={pending === "on"}
            disabled={pending !== null}
            onContinue={() => void submit(true)}
            onNotNow={() => void submit(false)}
          />
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

/**
 * For an AI entry point on the phone (Ask, Catch me up, minutes from notes):
 * `await ensureConsent()` before the first call, and render `consentSheet`
 * once in the screen. Mobile's half of web's `useAiConsentGate`
 * (`apps/web/components/ai/meet-frapp-ai.tsx`), with the same contract:
 *
 * - `true` at once for a member who has Frapp AI on;
 * - Meet Frapp AI for anyone else, resolving `true` on Continue and `false`
 *   on Not now or a swipe away;
 * - `false` when the server has no AI;
 * - a rejection when the answer can't be read (offline, a failed request), so
 *   the entry point can say it couldn't check rather than doing nothing.
 *
 * The server checks again on every call (`ai.consent.required`), so a screen
 * that skips this still cannot send anything; it only gets the refusal.
 */
export function useAiConsentGate(): {
  ensureConsent: () => Promise<boolean>;
  consentSheet: ReactNode;
} {
  const choice = useFrappAiChoice();
  const sheetRef = useRef<BottomSheetModal>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);
  const { readConsent } = choice;

  const finish = useCallback((ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
  }, []);
  // A screen that goes away with the sheet up answers No. Nothing else would
  // settle the promise: the sheet's own close is not promised on unmount,
  // and a caller that outlives the screen (a question asked from a channel,
  // which waits in the one Ask conversation, #4713) would wait forever and
  // hold every later question behind it.
  useEffect(() => () => finish(false), [finish]);

  const ensureConsent = useCallback(async (): Promise<boolean> => {
    const state = await readConsent();
    if (!state) return false;
    if (state.answer === "yes") return true;
    // A second press while the sheet is up answers the first one's question.
    settle.current?.(false);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      sheetRef.current?.present();
    });
  }, [readConsent]);

  const consentSheet = choice.consent ? (
    <MeetFrappAiSheet
      ref={sheetRef}
      onAnswered={finish}
      // After `onAnswered`, so a swipe away with no answer settles as No and
      // an answered sheet's close settles nothing twice.
      onClosed={() => finish(false)}
    />
  ) : null;

  return { ensureConsent, consentSheet };
}

/**
 * Ask's mark: a four-point spark, a 1.6px stroke on a 24px grid with a
 * low-opacity fill of its own hue, as the bell is drawn
 * (`spec/ui/design-system/iconography.md` §1).
 */
export function SparkGlyph({
  color,
  size = 22,
}: {
  color: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.5c.5 4.3 2.2 6 6.5 6.5-4.3.5-6 2.2-6.5 6.5-.5-4.3-2.2-6-6.5-6.5 4.3-.5 6-2.2 6.5-6.5Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill={tint(color, 0.16)}
      />
      <Path
        d="M18.5 15.5v4M16.5 17.5h4"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.lg,
    },
    // The notifications step's card, so the two beats match.
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      paddingVertical: tokens.spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
      marginHorizontal: tokens.spacing.md,
    },
    rowLabel: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    disclosure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    link: {
      color: tokens.color.text.foreground,
      textDecorationLine: "underline",
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    quietButton: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      justifyContent: "center",
      marginTop: tokens.spacing.xs,
    },
    quietButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
      textDecorationLine: "underline",
    },
    sheetBody: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    sheetTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    sheetActions: {
      marginTop: tokens.spacing.sm,
    },
  });
}
