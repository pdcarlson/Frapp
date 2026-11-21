import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCurrentUser,
  useListChapters,
  useUpdateOnboarding,
  useUpdateUser,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  DISPLAY_NAME_MAX_LENGTH,
  ONBOARDING_PROFILE_ANSWERED_EVENT,
  ONBOARDING_YOU_COPY,
  initialNameField,
  needsName,
  typedNameMissing,
  onboardingProfileAnsweredProperties,
} from "@repo/validation";
import {
  PUSH_ASK_TITLE,
  PushAskActions,
  PushAskBody,
} from "@/components/notifications/push-ask";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import {
  OnboardingFieldLabel,
  OnboardingTextInput,
} from "@/components/onboarding/onboarding-field";
import { ProfilePhoto } from "@/components/profile/profile-photo";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { useAuthSession } from "@/lib/auth-session";
import { initialsFor } from "@/lib/more/narrow";
import { selectViewerProfile } from "@/lib/more/profile";
import { selectOnboardingMembership } from "@/lib/onboarding/membership";
import { welcomeStepAfterName } from "@/lib/onboarding/welcome-progress";
import { markWelcomeDue } from "@/lib/onboarding/welcome-due";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { useLatestTrack } from "@/lib/use-latest-track";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03, the two screens after a member joins (`spec/ui/mobile/screens.md`,
 * #5627; Paul's pick 2026-11-19, "Two: name, then notifications"):
 *
 * 1. **How the chapter sees you**, always: the name, pre-filled when sign-in
 *    carried a real one (Apple or Google), and an optional photo. A name that
 *    is only the API's `Member` or the email before the `@` starts empty
 *    (`needsName` in `@repo/validation`); a typed name is required
 *    (`typedNameMissing`). Web shows the same
 *    screen after a join (`apps/web/app/(auth)/welcome`).
 * 2. **Turn on notifications**, when this build can push and push isn't on
 *    yet (`shouldOfferPrimer`, #2299). Either answer goes to chat; a "Not
 *    now" comes back once, days later, on the chat home (`usePushReminder`).
 *
 * The rest waits until the member wants it: chat display in Preferences,
 * roles in the Directory's Add roles, and Meet Frapp AI at the first use of
 * an AI feature (`useAiConsentGate`). They were three more beats here until
 * #5627.
 *
 * Which screen comes first waits on the push read only so the button can say
 * where it goes; nothing is drawn until the profile and push reads are back,
 * and a slow read is given up on after {@link DECIDE_TIMEOUT_MS}.
 *
 * Saving the name PATCHes `has_completed_onboarding` (Paul, 2026-11-21),
 * not leaving the last screen: the name is the account's, so web's welcome
 * (which is the name alone) and this phone never ask it twice. Ethan joined
 * in the app on 2026-11-20, went to the browser before the notifications
 * screen, and was asked his name again there, then again back here.
 * Notifications are this phone's own, so a member who finished on another
 * device and lands here (or is sitting here when it happens) goes straight
 * to them, or to chat when there is nothing to ask (`welcomeStepAfterName`).
 * One surface and one gold button pinned above the inset on each screen (the
 * #3348 screen rules).
 */
const DECIDE_TIMEOUT_MS = 4_000;

type Beat = "you" | "notifications";

export default function Welcome() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status, chapterId } = useAuthSession();
  const queryClient = useQueryClient();
  const updateOnboarding = useUpdateOnboarding();
  const chapters = useListChapters({ enabled: status === "authenticated" });
  // Whether the name is already answered, here or on another device: the
  // membership's flag, as the gate reads it.
  const nameDoneElsewhere =
    selectOnboardingMembership(
      Array.isArray(chapters.data) ? chapters.data : [],
      chapterId,
    )?.has_completed_onboarding === true;
  // Set once this visit has written the flag, so leaving doesn't write it
  // again.
  const markedDoneRef = useRef(false);
  const primer = usePushPrimer();
  const [leaving, setLeaving] = useState(false);
  // The guard itself, since two taps in one frame both read `leaving` false.
  const leavingRef = useRef(false);
  // `deciding` until the profile and push reads are back (or given up on).
  const [step, setStep] = useState<"deciding" | Beat>("deciding");
  const [waitedOut, setWaitedOut] = useState(false);
  const userQuery = useCurrentUser();
  const updateUser = useUpdateUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  // Whether there was a photo when the screen opened, so its event can tell
  // a photo chosen on it from one the member already had.
  const [hadPhoto, setHadPhoto] = useState(false);
  const track = useLatestTrack();
  // `null` until typed in: the field shows the loaded name until then.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const nameValue =
    nameDraft ??
    initialNameField(profile?.displayName ?? null, profile?.email ?? null);

  async function markDone() {
    // Already written, by this visit or by another device.
    if (markedDoneRef.current || nameDoneElsewhere) return;
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
      markedDoneRef.current = true;
    } catch {
      // Non-fatal — the next session re-offers s03 if the write never landed.
    }
  }

  async function finish() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    await markDone();
    // The welcome card in the default channel shows once, for the member who
    // just came through here (#5627).
    // A profile read that never landed is asked once more here, so a slow
    // read can't cost the member the landing and the card.
    const idOf = (data: unknown) => (data as { id?: string } | undefined)?.id;
    const userId =
      idOf(userQuery.data) ??
      (await userQuery
        .refetch()
        .then((result) => idOf(result.data))
        .catch(() => undefined));
    if (userId) await markWelcomeDue(userId, chapterId);
    await queryClient.invalidateQueries({ queryKey: ["chapters"] });
    router.replace("/");
  }

  // Latched when Continue opens it, not re-derived from `showPrimer`: an
  // answer is stored before the OS dialog opens and before the PATCH, and
  // the step must stay on screen (busy) until the member has left for chat.
  const asking = step === "notifications";
  const answering = primer.isRequesting || leaving || savingName;

  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), DECIDE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const profileKnown =
    userQuery.data !== undefined || userQuery.isError || waitedOut;
  const primerKnown = primer.ready || waitedOut;
  if (step === "deciding" && profileKnown && primerKnown) {
    setHadPhoto(!!profile?.photoUrl);
    setStep("you");
  }

  // The name answered on another device, before this screen opened or while
  // it sat on the name: this phone asks only what is its own.
  const afterNameElsewhere =
    step === "you" && nameDoneElsewhere && !savingName && !leaving
      ? welcomeStepAfterName(primer.showPrimer)
      : null;
  if (afterNameElsewhere === "notifications") setStep("notifications");
  const leaveForChat = afterNameElsewhere === "chat";
  useEffect(() => {
    if (leaveForChat) void finish();
    // `finish` is a plain function of this render; the answer is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveForChat]);

  // Validated on Continue, not per keystroke. A name that didn't change isn't
  // sent again; one that did is saved before the member moves on, so a
  // failure keeps them here with the reason rather than losing the name.
  async function leaveYou() {
    if (savingName || leaving) return;
    const name = nameValue.trim();
    if (typedNameMissing(name)) {
      setNameError(ONBOARDING_YOU_COPY.nameRequired);
      return;
    }
    const nameChanged = name !== (profile?.displayName ?? "").trim();
    if (nameChanged) {
      setSavingName(true);
      try {
        await updateUser.mutateAsync({ display_name: name });
      } catch {
        setNameError(ONBOARDING_YOU_COPY.saveFailed);
        return;
      } finally {
        setSavingName(false);
      }
    }
    track(
      ONBOARDING_PROFILE_ANSWERED_EVENT,
      onboardingProfileAnsweredProperties({
        hadPhoto,
        hasPhoto: !!profile?.photoUrl,
        hadName: !needsName(profile?.displayName, profile?.email ?? null),
        nameChanged,
      }),
    );
    // The name is the account's part of onboarding, so it counts as done
    // now, on every device, before this phone's own notifications ask.
    if (welcomeStepAfterName(primer.showPrimer) === "notifications") {
      await markDone();
      setStep("notifications");
    } else void finish();
  }

  // Android's back on the notifications screen returns to the name, as a
  // back gesture between two screens would; it never leaves onboarding half
  // done. Held while an answer is on its way out. The first screen leaves
  // Android's back alone.
  useEffect(() => {
    if (step !== "notifications") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!answering) setStep("you");
      return true;
    });
    return () => sub.remove();
  }, [step, answering]);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Nothing drawn while the reads come back (usually a frame or two): no
  // spinner, and no screen that the next read would swap out.
  if (step === "deciding") {
    return <View style={styles.container} testID="welcome-deciding" />;
  }

  return (
    // Safe area on every edge (#3345): `(auth)` renders with `headerShown:
    // false`, and Android draws the app edge to edge, so nothing else keeps
    // this screen off the status bar or its last control off the swipe bar.
    <SafeAreaView
      style={styles.container}
      edges={["top", "right", "bottom", "left"]}
    >
      {/* The name field opens the keyboard, which must not cover it or the
          pinned Continue (#3354). */}
      <KeyboardAvoidingArea style={styles.flex} atScreenBottom>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {asking ? (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {PUSH_ASK_TITLE}
              </Text>
              <View style={styles.channels}>
                <PushAskBody />
              </View>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {ONBOARDING_YOU_COPY.title}
              </Text>
              <Text style={styles.subtitle}>{ONBOARDING_YOU_COPY.lede}</Text>
              <View style={styles.photo}>
                <ProfilePhoto
                  photoUrl={profile?.photoUrl ?? null}
                  fetchedAt={userQuery.dataUpdatedAt}
                  initials={initialsFor(nameValue.trim() || null)}
                />
              </View>
              <View style={styles.nameField}>
                <OnboardingFieldLabel>
                  {ONBOARDING_YOU_COPY.nameLabel}
                </OnboardingFieldLabel>
                <OnboardingTextInput
                  value={nameValue}
                  onChangeText={(value) => {
                    setNameDraft(value);
                    setNameError(null);
                  }}
                  placeholder={ONBOARDING_YOU_COPY.namePlaceholder}
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoComplete="name"
                  textContentType="name"
                  accessibilityLabel={ONBOARDING_YOU_COPY.nameLabel}
                  editable={!savingName && !leaving}
                  returnKeyType="done"
                  onSubmitEditing={() => void leaveYou()}
                />
                {nameError ? (
                  <Text style={styles.error} accessibilityLiveRegion="polite">
                    {nameError}
                  </Text>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>

        {/*
        One gold button per screen. On the name it moves on: to notifications
        when there is one to ask, else to chat. On notifications it asks, and
        Not now is the quiet line under it; either answer leaves for chat,
        after the OS dialog closes.
      */}
        <View style={styles.footer}>
          {asking ? (
            <PushAskActions
              action={primer.action}
              busy={answering}
              onTurnOn={() => {
                void primer.turnOn().then((outcome) => {
                  if (outcome !== null) void finish();
                });
              }}
              onNotNow={() => {
                void primer.notNow().then((answered) => {
                  if (answered) void finish();
                });
              }}
            />
          ) : (
            <OnboardingPrimaryButton
              label={
                primer.showPrimer
                  ? ONBOARDING_YOU_COPY.continue
                  : ONBOARDING_YOU_COPY.goToChat
              }
              disabled={answering}
              busy={answering}
              onPress={() => void leaveYou()}
            />
          )}
        </View>
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    flex: { flex: 1 },
    // One column, as wide as the join and setup screens', centred on a
    // tablet.
    scroll: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH + tokens.spacing.xl * 2,
      alignSelf: "center",
      paddingHorizontal: tokens.spacing.xl,
      paddingTop: tokens.spacing["3xl"],
      paddingBottom: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    channels: {
      marginTop: tokens.spacing.lg,
    },
    photo: {
      marginTop: tokens.spacing.xl,
      alignItems: "center",
    },
    nameField: {
      marginTop: tokens.spacing.xl,
      gap: tokens.spacing.xs,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    footer: {
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing.lg,
    },
  });
}
