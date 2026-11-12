import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import {
  errorCopy,
  useAiConsent,
  useAnswerAiConsent,
  type AiConsentState,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_CONSENT_COPY,
  formatAiAnswerDate,
  joinNames,
} from "@repo/validation";
import { eyebrowStyle } from "@/components/eyebrow";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The member's AI sheet on the phone (`spec/behavior/ai.md` § Consent, gate
 * 2; #4308, store gate #3297). The phone is where most members meet it, so
 * it says the same thing web's does, from the same words (`AI_CONSENT_COPY`)
 * and the same rows: who the data goes to and what can be sent come from the
 * server with the sheet's version (`GET /v1/ai/consent`), so a build
 * installed before a new version still shows and answers the current one.
 *
 * It opens where a member first reaches for an AI feature
 * ({@link useAiConsentGate}), the way iOS asks for the camera when a member
 * first taps the camera rather than at launch. Settings opens the same sheet
 * to change the answer any time.
 *
 * Yes and No are the same size, side by side: Apple's 5.1.2(i) asks for
 * explicit permission, and a No drawn as a small link is not a real choice.
 * Swiping the sheet away is not an answer; unanswered counts as No on the
 * server, and the next AI entry point asks again.
 */

type Answer = "yes" | "no";

export interface AiConsentSheetProps {
  /** The sheet and the member's standing on it, from `useAiConsent`. */
  consent: AiConsentState;
  /** Called with the saved answer once the server has it. */
  onAnswered?: (answer: Answer) => void;
  /** The sheet closed, however it closed. */
  onClosed?: () => void;
}

export const AiConsentSheet = forwardRef<BottomSheetModal, AiConsentSheetProps>(
  function AiConsentSheet({ consent, onAnswered, onClosed }, ref) {
    const { tokens } = useFrappTheme();
    const { accent } = useChapterBranding();
    const styles = createStyles(tokens);
    const backgroundStyle = useSheetBackgroundStyle();
    const closeSheet = useSheetClose(ref);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);
    const answer = useAnswerAiConsent();
    const [error, setError] = useState<string | null>(null);
    // Which button was pressed, so only that one shows it is saving.
    const [pending, setPending] = useState<Answer | null>(null);
    // The sheet can be swiped away while an answer is saving. Its close is
    // reported only once the save has ended, after the answer if there is
    // one, so a Yes that was on its way is never reported as "closed, no
    // answer".
    const saving = useRef(false);
    const closedWhileSaving = useRef(false);

    const providers = joinNames(
      consent.sheet.providers.map((provider) => provider.name),
    );
    const changed = consent.sheet_changed;

    const submit = useCallback(
      async (choice: Answer) => {
        if (pending !== null) return;
        setError(null);
        setPending(choice);
        saving.current = true;
        const sentFrom = visit();
        try {
          await answer.mutateAsync({
            sheet_version: consent.sheet.version,
            answer: choice,
          });
          onAnswered?.(choice);
          if (isSameVisit(sentFrom)) dismiss();
        } catch (failure) {
          // A stale sheet refetches itself (`useAnswerAiConsent`); the member
          // reads the new rows here, then answers again.
          if (isSameVisit(sentFrom)) {
            setError(errorCopy(failure, AI_CONSENT_COPY.saveFailed));
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
      [
        answer,
        consent.sheet.version,
        dismiss,
        isSameVisit,
        onAnswered,
        onClosed,
        pending,
        visit,
      ],
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
          contentContainerStyle={styles.body}
        >
          <Text accessibilityRole="header" style={styles.title}>
            {changed ? AI_CONSENT_COPY.titleChanged : AI_CONSENT_COPY.title}
          </Text>
          <Text style={styles.intro}>
            {changed
              ? AI_CONSENT_COPY.introChanged(providers)
              : AI_CONSENT_COPY.intro(providers)}
          </Text>

          <AiConsentDetails sheet={consent.sheet} />

          {/* One line that says where to change the answer, and says why a
              save failed in its place, so an error never moves the buttons. */}
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.footnote, error ? styles.footnoteError : null]}
          >
            {error ?? standingLine(consent) ?? AI_CONSENT_COPY.changeLater}
          </Text>

          <View style={styles.buttons}>
            <View style={styles.button}>
              <OnboardingSecondaryButton
                fill
                label={AI_CONSENT_COPY.no}
                busy={pending === "no"}
                disabled={pending !== null}
                onPress={() => void submit("no")}
              />
            </View>
            <View style={styles.button}>
              <SheetPrimaryButton
                label={AI_CONSENT_COPY.yes}
                busy={pending === "yes"}
                disabled={pending !== null}
                onPress={() => void submit("yes")}
                accent={accent}
                onAccent={tokens.color.gold.onHouse}
              />
            </View>
          </View>
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);

/**
 * What the member answered before, for the sheet opened from Settings. Null
 * for a member who has never answered, who reads where to change it instead.
 */
function standingLine(consent: AiConsentState): string | null {
  if (consent.sheet_changed) return null;
  if (!consent.answer || !consent.answered_at) return null;
  const date = formatAiAnswerDate(consent.answered_at);
  return consent.answer === "yes"
    ? AI_CONSENT_COPY.answeredYes(date)
    : AI_CONSENT_COPY.answeredNo(date);
}

/** The sheet's body: who it goes to, what goes, and what No means. */
export function AiConsentDetails({
  sheet,
}: {
  sheet: AiConsentState["sheet"];
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.details}>
      <DetailBlock heading={AI_CONSENT_COPY.sentToHeading}>
        <Text style={styles.detailText}>
          {joinNames(sheet.providers.map((provider) => provider.name))}
        </Text>
      </DetailBlock>
      <DetailBlock heading={AI_CONSENT_COPY.dataHeading}>
        <Bullets items={sheet.data.map((kind) => kind.label)} />
      </DetailBlock>
      <DetailBlock heading={AI_CONSENT_COPY.noHeading}>
        <Bullets items={AI_CONSENT_COPY.noMeans} />
      </DetailBlock>
    </View>
  );
}

function DetailBlock({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.eyebrow}>
        {heading}
      </Text>
      {children}
    </View>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.bullets}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <View
            style={styles.bulletDot}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={styles.detailText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * For an AI entry point on the phone (Ask, minutes from notes): `await
 * ensureConsent()` before the first call, and render `consentSheet` once in
 * the screen. Mobile's half of web's `useAiConsentGate`
 * (`apps/web/components/ai/ai-consent-sheet.tsx`), with the same contract:
 *
 * - `true` at once for a member who said yes on the current sheet;
 * - the sheet for anyone else, resolving with their answer (`false` for No
 *   and for swiping it away);
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
  const consentQuery = useAiConsent();
  const sheetRef = useRef<BottomSheetModal>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    settle.current?.(ok);
    settle.current = null;
  }, []);

  const ensureConsent = useCallback(async (): Promise<boolean> => {
    let state = consentQuery.data;
    if (state === undefined) {
      const read = await consentQuery.refetch();
      // A failed read is not a No.
      if (read.error) throw read.error;
      state = read.data;
    }
    if (!state) return false;
    if (state.answer === "yes") return true;
    // A second press while the sheet is up answers the first one's question.
    settle.current?.(false);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      sheetRef.current?.present();
    });
  }, [consentQuery]);

  const consentSheet = consentQuery.data ? (
    <AiConsentSheet
      ref={sheetRef}
      consent={consentQuery.data}
      onAnswered={(answer) => finish(answer === "yes")}
      // After `onAnswered`, so a swipe away with no answer settles as No and
      // an answered sheet's close settles nothing twice.
      onClosed={() => finish(false)}
    />
  ) : null;

  return { ensureConsent, consentSheet };
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    intro: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    details: {
      gap: tokens.spacing.md,
    },
    block: {
      gap: tokens.spacing.xs,
    },
    eyebrow: {
      ...eyebrowStyle(tokens),
      color: tokens.color.text.mutedForeground,
    },
    bullets: {
      gap: tokens.spacing.xs,
    },
    bulletRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    bulletDot: {
      width: tokens.spacing.xs,
      height: tokens.spacing.xs,
      borderRadius: tokens.spacing.xs / 2,
      // Level with the first line's middle: body's line height is 25.
      marginTop: (tokens.typography.role.body.lineHeight ?? 25) / 2 - 2,
      backgroundColor: tokens.color.text.muted,
    },
    detailText: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      // Two lines high whichever line it holds, so a failed save never moves
      // the buttons under the member's thumb.
      minHeight: 36,
    },
    footnoteError: {
      color: tokens.color.semantic.destructiveText,
    },
    buttons: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: tokens.spacing.sm,
    },
    button: {
      flex: 1,
    },
  });
}
