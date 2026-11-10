import { useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { BackHandler, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCurrentUser,
  useUpdateOnboarding,
  useUpdateUser,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
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
import { ChatDensityOptions } from "@/components/settings/chat-density-sheet";
import {
  ONBOARDING_COLUMN_WIDTH,
  OnboardingPrimaryButton,
} from "@/components/onboarding/onboarding-primary-button";
import { useAuthSession } from "@/lib/auth-session";
import { initialsFor } from "@/lib/more/narrow";
import { selectViewerProfile } from "@/lib/more/profile";
import {
  PROFILE_NAME_REQUIRED,
  PROFILE_NAME_SAVE_FAILED,
  PROFILE_STEP_SUBTITLE,
  PROFILE_STEP_TITLE,
  ONBOARDING_PROFILE_ANSWERED_EVENT,
  initialNameField,
  needsName,
  onboardingProfileAnsweredProperties,
  shouldOfferProfileStep,
} from "@/lib/onboarding/profile-step";
import { TOUR_DUE_ANYONE, markTourDue } from "@/lib/onboarding/tour";
import {
  DISPLAY_STEP_SUBTITLE,
  DISPLAY_STEP_TITLE,
} from "@/lib/onboarding/display-step";
import { usePushPrimer } from "@/lib/notifications/use-push-primer";
import { useLatestTrack } from "@/lib/use-latest-track";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03, the member's first-run steps (`spec/ui/mobile/screens.md`).
 *
 * The screens right after a member joins, in up to three beats on one route,
 * the first and last shown only when they have something to ask:
 *
 * 1. **How the chapter sees you**, when the member has no photo or no real
 *    name yet (`lib/onboarding/profile-step.ts`). The photo is optional; the
 *    name is required only when there isn't one, and a real one comes
 *    pre-filled. Every message carries both, so a member who skips this looks
 *    like a stranger in every channel.
 * 2. **Pick your chat display**, always (#3787, Winston's decision: the
 *    member decides while setting up). Cozy is preselected, so Continue keeps
 *    today's default; a tap saves the pick on this phone at once.
 * 3. **Turn on notifications**, when this build can push and push isn't on
 *    yet (`shouldOfferPrimer`, #2299). Either answer goes to chat; a "Not
 *    now" comes back once, days later, on the chat home (`usePushReminder`).
 *
 * Then chat, with the first-run tour over it (`lib/onboarding/tour.ts`). The
 * static "You're in." card that used to open s03 is gone (owner brief
 * 2026-11-07): the tour's first stop says it, pointing at the real channels.
 * A member with a photo, a name and push on sees only the display beat.
 *
 * Which beat comes first waits on the profile and push reads; nothing is drawn
 * until they're back, and a slow read is given up on after
 * {@link DECIDE_TIMEOUT_MS} (the profile beat is then skipped; Profile in More
 * still has both).
 *
 * Leaving PATCHes `has_completed_onboarding`, so the gate will not send the
 * member here again. One surface and one gold button pinned above the inset
 * on each beat (the #3348 screen rules).
 */
const DECIDE_TIMEOUT_MS = 4_000;

export default function Welcome() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();
  const { status } = useAuthSession();
  const queryClient = useQueryClient();
  const updateOnboarding = useUpdateOnboarding();
  const primer = usePushPrimer();
  const [leaving, setLeaving] = useState(false);
  // The guard itself, since two taps in one frame both read `leaving` false.
  const leavingRef = useRef(false);
  // `deciding` until the profile and push reads are back (or given up on).
  const [step, setStep] = useState<
    "deciding" | "profile" | "display" | "notifications"
  >("deciding");
  const [waitedOut, setWaitedOut] = useState(false);
  const userQuery = useCurrentUser();
  const updateUser = useUpdateUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const offerProfile = shouldOfferProfileStep(profile);
  // Latched when the profile beat opens, so the notifications beat's back
  // returns to it only when it was shown. A photo chosen on it must not make
  // it vanish under the member.
  const [profileShown, setProfileShown] = useState(false);
  // Whether there was a photo when the beat opened, so its event can tell a
  // photo chosen on it from one the member already had.
  const [hadPhoto, setHadPhoto] = useState(false);
  const track = useLatestTrack();
  // `null` until typed in: the field shows the loaded name until then.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const nameValue = nameDraft ?? initialNameField(profile?.displayName ?? null);

  async function finish() {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      await updateOnboarding.mutateAsync({ has_completed_onboarding: true });
    } catch {
      // Non-fatal — the next session re-offers s03 if the write never landed.
    }
    // The tour over chat runs once, for the member who just came through here.
    const userId = (userQuery.data as { id?: string } | undefined)?.id;
    await markTourDue(userId ?? TOUR_DUE_ANYONE);
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

  // The first beat, decided once both reads are back. Latched: a photo chosen
  // on the profile beat, or push turned on in Settings meanwhile, must not
  // move the member to another beat under their thumb.
  const profileKnown =
    userQuery.data !== undefined || userQuery.isError || waitedOut;
  const primerKnown = primer.ready || waitedOut;
  if (step === "deciding" && profileKnown && primerKnown) {
    if (offerProfile) {
      setHadPhoto(!!profile?.photoUrl);
      setProfileShown(true);
      setStep("profile");
    } else {
      setStep("display");
    }
  }

  function leaveDisplay() {
    if (leaving) return;
    if (primer.showPrimer) {
      setStep("notifications");
    } else {
      void finish();
    }
  }

  // Validated on Continue, not per keystroke. A name that didn't change isn't
  // sent again; one that did is saved before the member moves on, so a
  // failure keeps them here with the reason rather than losing the name.
  async function leaveProfile() {
    if (savingName || leaving) return;
    const name = nameValue.trim();
    if (needsName(name)) {
      setNameError(PROFILE_NAME_REQUIRED);
      return;
    }
    const nameChanged = name !== (profile?.displayName ?? "").trim();
    if (nameChanged) {
      setSavingName(true);
      try {
        await updateUser.mutateAsync({ display_name: name });
      } catch {
        setNameError(PROFILE_NAME_SAVE_FAILED);
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
        hadName: !needsName(profile?.displayName),
        nameChanged,
      }),
    );
    setStep("display");
  }

  // Android's back on a later beat returns to the one before it, as a back
  // gesture between two screens would; it never leaves onboarding half done.
  // Held while an answer is on its way out.
  // The first beat leaves Android's back alone, as the old first beat did.
  useEffect(() => {
    const previous =
      step === "notifications"
        ? "display"
        : step === "display" && profileShown
          ? "profile"
          : null;
    if (previous === null) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!answering) setStep(previous);
      return true;
    });
    return () => sub.remove();
  }, [step, answering, profileShown]);

  if (status === "unauthenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Nothing drawn while the first beat is decided (usually a frame or two):
  // no spinner, and no beat that the next read would swap out.
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
      {/* The profile beat's name field opens the keyboard, which must not
          cover it or the pinned Continue (#3354). */}
      <KeyboardAvoidingArea style={styles.flex}>
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
          ) : step === "display" ? (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {DISPLAY_STEP_TITLE}
              </Text>
              <Text style={styles.subtitle}>{DISPLAY_STEP_SUBTITLE}</Text>
              <View style={styles.channels}>
                <ChatDensityOptions />
              </View>
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {PROFILE_STEP_TITLE}
              </Text>
              <Text style={styles.subtitle}>{PROFILE_STEP_SUBTITLE}</Text>
              <View style={styles.photo}>
                <ProfilePhoto
                  photoUrl={profile?.photoUrl ?? null}
                  fetchedAt={userQuery.dataUpdatedAt}
                  initials={initialsFor(nameValue.trim() || null)}
                />
              </View>
              <View style={styles.nameField}>
                <OnboardingFieldLabel>Your name</OnboardingFieldLabel>
                <OnboardingTextInput
                  value={nameValue}
                  onChangeText={(value) => {
                    setNameDraft(value);
                    setNameError(null);
                  }}
                  placeholder="First and last name"
                  autoCapitalize="words"
                  autoCorrect={false}
                  autoComplete="name"
                  textContentType="name"
                  accessibilityLabel="Your name"
                  editable={!savingName && !leaving}
                  returnKeyType="done"
                  onSubmitEditing={() => void leaveProfile()}
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
        One gold button per beat. On the profile beat it moves on: to the
        notifications beat when there is one to show, else to chat. On the
        notifications beat it asks, and Not now is the quiet line under it;
        either answer leaves for chat, after the OS dialog closes.
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
          ) : step === "display" ? (
            <OnboardingPrimaryButton
              label={primer.showPrimer ? "Continue" : "Go to chat"}
              disabled={answering}
              busy={answering}
              onPress={leaveDisplay}
            />
          ) : (
            <OnboardingPrimaryButton
              label="Continue"
              disabled={answering}
              busy={answering}
              onPress={() => void leaveProfile()}
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
