import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import {
  cooldownCopy,
  describeEmailSendError,
  describePasswordSignInError,
  emailCooldownSeconds,
  isEmailNotConfirmed,
  UNCONFIRMED_EMAIL_COPY,
} from "@repo/hooks/auth-error-copy";
import { AuthMethod, useAuthSession } from "@/lib/auth-session";
import {
  describeOAuthKickoffError,
  OAUTH_MEMBERSHIP_HINT,
  signInProviderLayout,
  type OAuthProvider,
} from "@/lib/auth-providers";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { SignInMoments } from "@/components/auth/sign-in-moments";
import { BackRow } from "@/components/back-row";
import {
  OnboardingFieldLabel,
  OnboardingTextInput,
} from "@/components/onboarding/onboarding-field";
import { OnboardingPrimaryButton } from "@/components/onboarding/onboarding-primary-button";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { OnboardingSecondaryButton } from "@/components/onboarding/onboarding-secondary-button";
import { KeyboardAvoidingArea } from "@/lib/keyboard";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * GoTrue sends one address one auth email a minute, so Resend waits that
 * minute out after a send instead of meeting the refusal.
 */
const RESEND_COOLDOWN_SECONDS = 60;

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  apple: "Continue with Apple",
  google: "Continue with Google",
};

export default function SignIn() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const {
    callbackError,
    isConfigured,
    resendConfirmation,
    sendMagicLink,
    signInWithOAuthProvider,
    signInWithPassword,
    status,
  } = useAuthSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMethod>("password");
  const [emailOpen, setEmailOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  /**
   * Refusals are told in Frapp's words (`@repo/hooks/auth-error-copy`), never
   * GoTrue's sentence (#3833). A refusal that isn't a failure, such as a
   * magic link asked for inside the email minute, is a notice, not an error.
   */
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The address whose password matched but was never confirmed: a member who
   * made a password account on web and opened the app before the email. The
   * app has no sign-up of its own, so it offers to send the email again.
   */
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(
    null,
  );
  const [resending, setResending] = useState(false);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const passwordRef = useRef<TextInput>(null);

  // Android's back button and back gesture close the email form, as its
  // `‹ Back` row does, instead of leaving s01 (the `(auth)` anchor) and
  // backgrounding the app. While a sign-in is in flight both are held, so a
  // late result can't land on the provider view.
  useEffect(() => {
    if (resendSecondsLeft <= 0) return undefined;
    const timer = setTimeout(
      () => setResendSecondsLeft((left) => left - 1),
      1000,
    );
    return () => clearTimeout(timer);
  }, [resendSecondsLeft]);

  useEffect(() => {
    if (!emailOpen) return undefined;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!submitting) {
          setEmailOpen(false);
          clearMessages();
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, [emailOpen, submitting]);

  function clearMessages() {
    setAuthError(null);
    setNotice(null);
    setMagicLinkSentTo(null);
    setUnconfirmedEmail(null);
  }

  if (status === "authenticated") {
    // The auth gate owns the next hop (join / welcome / tabs). Rendering the
    // form for one more frame is the flash this used to paper over by jumping
    // straight to `(tabs)` — which skipped s03.
    return null;
  }

  const layout = signInProviderLayout(Platform.OS);
  const appleVisible =
    layout.primary === "apple" ||
    layout.secondary === "apple" ||
    (layout.tucked === "apple" && moreOpen);

  function isValidEmailAddress(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleSignIn(method: AuthMethod) {
    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmailAddress(normalizedEmail)) {
      setAuthError("Enter a valid chapter email before continuing.");
      return;
    }
    if (method === "password" && password.length === 0) {
      setAuthError("Enter your password before continuing.");
      return;
    }

    setSubmitting(true);
    clearMessages();

    try {
      if (method === "password") {
        await signInWithPassword({ email: normalizedEmail, password });
        // Do not send them to `(tabs)` from here. The auth gate decides join /
        // welcome / tabs from `has_completed_onboarding` and the chapters list;
        // skipping it is how s03 stayed unreachable after #957.
        return;
      }

      await sendMagicLink({ email: normalizedEmail });
      setMagicLinkSentTo(normalizedEmail);
    } catch (error) {
      if (method === "password") {
        if (isEmailNotConfirmed(error)) {
          setUnconfirmedEmail(normalizedEmail);
          setAuthError(UNCONFIRMED_EMAIL_COPY);
        } else {
          setAuthError(describePasswordSignInError(error));
        }
        return;
      }
      // Inside GoTrue's one-email minute a link already went out.
      const cooldown = emailCooldownSeconds(error);
      if (cooldown !== undefined) setNotice(cooldownCopy(cooldown));
      else setAuthError(describeEmailSendError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!unconfirmedEmail || resending || resendSecondsLeft > 0) return;
    setResending(true);
    setAuthError(null);
    setNotice(null);
    try {
      await resendConfirmation({ email: unconfirmedEmail });
      setResendSecondsLeft(RESEND_COOLDOWN_SECONDS);
      setNotice(
        `We sent a new link to ${unconfirmedEmail}. Open it on this phone to finish signing in.`,
      );
    } catch (error) {
      const cooldown = emailCooldownSeconds(error);
      if (cooldown !== undefined) {
        setResendSecondsLeft(Math.max(cooldown, 1));
        setNotice(cooldownCopy(cooldown));
      } else {
        setAuthError(describeEmailSendError(error));
      }
    } finally {
      setResending(false);
    }
  }

  /**
   * The Sign in button and the keyboard's return key both submit through here,
   * so return is held to the button's guard: while a sign-in, a magic link or
   * an OAuth kickoff is in flight the button is disabled, and return does
   * nothing either.
   */
  function submit() {
    if (submitting) return;
    void handleSignIn(authMode);
  }

  async function handleOAuth(provider: OAuthProvider) {
    setSubmitting(true);
    setOauthPending(provider);
    clearMessages();

    try {
      await signInWithOAuthProvider(provider);
    } catch (error) {
      // Already reported by `signInWithOAuthProvider` (#3832).
      setAuthError(describeOAuthKickoffError(error));
    } finally {
      setSubmitting(false);
      setOauthPending(null);
    }
  }

  function closeEmail() {
    if (submitting) return;
    setEmailOpen(false);
    clearMessages();
  }

  function renderProvider(provider: OAuthProvider, filled: boolean) {
    const foreground = filled
      ? tokens.color.surface.background
      : tokens.color.text.foreground;
    const pending = oauthPending === provider;
    const mark = pending ? (
      <ActivityIndicator color={foreground} size="small" />
    ) : provider === "apple" ? (
      <AppleMark color={foreground} />
    ) : (
      <GoogleMark />
    );
    const label = pending ? "Signing in…" : PROVIDER_LABEL[provider];
    if (!filled) {
      return (
        <OnboardingSecondaryButton
          key={provider}
          label={label}
          leading={mark}
          disabled={submitting}
          onPress={() => {
            void handleOAuth(provider);
          }}
        />
      );
    }
    // The phone's own account, the one light fill on the page. Pressed as the
    // onboarding buttons are, by the same owner: a ripple on Android, a
    // dimmed fill on iOS.
    return (
      <OnboardingPressable
        key={provider}
        accessibilityRole="button"
        accessibilityState={{ disabled: submitting }}
        disabled={submitting}
        onPress={() => {
          void handleOAuth(provider);
        }}
        rippleColor={styles.filledRipple.color}
        style={[styles.button, styles.buttonFilled]}
      >
        {mark}
        <Text style={[styles.buttonText, styles.buttonTextFilled]}>
          {label}
        </Text>
      </OnboardingPressable>
    );
  }

  const messages = (
    <>
      {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
      {notice ? <Text style={styles.successText}>{notice}</Text> : null}
      {/* A dead magic link lands back here; without this the member cannot
        tell a broken link from one they never tapped. */}
      {!authError && callbackError ? (
        <Text style={styles.errorText}>{callbackError}</Text>
      ) : null}
      {!isConfigured ? (
        <Text style={styles.errorText}>
          EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not set
          for this build, so sign-in is unavailable.
        </Text>
      ) : null}
    </>
  );

  return (
    // Safe area on every edge: `(auth)` renders with `headerShown: false`, so
    // nothing else keeps the mark off the status bar or the last control off
    // the home indicator or the Android swipe bar.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      {/*
        One surface (#3349): no card over the page. The owner read the old
        card-on-background as "two different surfaces".

        The column scrolls, and `flexGrow: 1` lets it fill the screen when it
        fits, with the brand at the top and the actions at the bottom, in
        thumb reach. Folded, it fits a 6.1" phone without scrolling; a smaller
        screen, or the open email form, scrolls instead of clipping (an
        iPhone SE once lost "Sign in" below the edge, 2026-09-22).

        Keyboard on iOS: `automaticallyAdjustKeyboardInsets` insets the scroll
        view by the keyboard and scrolls the focused field above it. A padding
        view on top would count the keyboard twice, so the area below is a
        plain view on iOS.

        Keyboard on Android: that prop does nothing there, and the app-wide
        `KeyboardProvider` stops the window from resizing (#3346). The email
        form replaces the brand and opens at the top of the column, and the
        area below pads the scroll view by the keyboard, so on a short screen
        the column scrolls instead of the keyboard covering "Sign in".
      */}
      <KeyboardAvoidingArea
        style={styles.scroll}
        iosInsetFromScrollView
        atScreenBottom
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {emailOpen ? (
            <View style={styles.emailColumn}>
              {/* The board's s02 `‹ Back`, in house gold: sign-in has no
                chapter accent to take. */}
              <BackRow
                house
                label="Back"
                accessibilityLabel="Back to sign-in options"
                disabled={submitting}
                onPress={closeEmail}
              />
              <Text style={styles.emailTitle}>Sign in with email</Text>

              <View style={styles.field}>
                <OnboardingFieldLabel>Chapter email</OnboardingFieldLabel>
                <OnboardingTextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@university.edu"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  autoFocus
                  keyboardType="email-address"
                  textContentType="username"
                  // Password mode: return moves to the password field, keeping
                  // the keyboard up. Magic-link mode has no field after this
                  // one, so return sends the link, as the button would.
                  returnKeyType={authMode === "password" ? "next" : "send"}
                  submitBehavior={
                    authMode === "password" ? "submit" : "blurAndSubmit"
                  }
                  onSubmitEditing={() => {
                    if (authMode === "password") passwordRef.current?.focus();
                    else submit();
                  }}
                />
              </View>

              <View style={styles.modeRow}>
                <OnboardingPressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: authMode === "password" }}
                  onPress={() => setAuthMode("password")}
                  style={[
                    styles.modeButton,
                    authMode === "password" ? styles.modeButtonActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      authMode === "password"
                        ? styles.modeButtonTextActive
                        : null,
                    ]}
                  >
                    Password
                  </Text>
                </OnboardingPressable>
                <OnboardingPressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: authMode === "magic_link" }}
                  onPress={() => setAuthMode("magic_link")}
                  style={[
                    styles.modeButton,
                    authMode === "magic_link" ? styles.modeButtonActive : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeButtonText,
                      authMode === "magic_link"
                        ? styles.modeButtonTextActive
                        : null,
                    ]}
                  >
                    Magic link
                  </Text>
                </OnboardingPressable>
              </View>

              {authMode === "password" ? (
                <View style={styles.field}>
                  <OnboardingFieldLabel>Password</OnboardingFieldLabel>
                  <OnboardingTextInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={submit}
                  />
                </View>
              ) : (
                <Text style={styles.helperText}>
                  We&apos;ll email you a link that signs you in on this device.
                </Text>
              )}

              {messages}
              {/* Only for the address that was refused: an edited email is a
                different account, and Sign in asks about it afresh. */}
              {unconfirmedEmail &&
              unconfirmedEmail === email.trim().toLowerCase() ? (
                <OnboardingSecondaryButton
                  label={
                    resending
                      ? "Sending…"
                      : resendSecondsLeft > 0
                        ? `Resend email in ${resendSecondsLeft}s`
                        : "Resend email"
                  }
                  disabled={submitting || resending || resendSecondsLeft > 0}
                  onPress={() => {
                    void handleResend();
                  }}
                />
              ) : null}
              {magicLinkSentTo ? (
                <Text style={styles.successText}>
                  Link sent to {magicLinkSentTo}. Open it on this device to
                  finish signing in.
                </Text>
              ) : null}

              {/* The onboarding primary, so a press shows and the wait is a
                spinner. The busy label is what a screen reader hears over it,
                and names what is running: a magic link isn't a sign-in yet. */}
              <View style={styles.primaryWrap}>
                <OnboardingPrimaryButton
                  label={
                    authMode === "password"
                      ? submitting
                        ? "Signing in…"
                        : "Sign in"
                      : submitting
                        ? "Sending link…"
                        : "Email me a link"
                  }
                  disabled={submitting}
                  busy={submitting}
                  onPress={submit}
                />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.brand}>
                <Image
                  // Metro asset id. This app has no `*.png` module declaration,
                  // so a static ESM import fails `tsc` (TS2307) even though
                  // Metro is fine.
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  source={require("../../assets/images/icon.png")}
                  style={styles.mark}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <Text style={styles.title}>Frapp</Text>
                {/*
                  The landing's closing line (D8, `spec/ui/landing/README.md`),
                  not the brand tagline "Ask your chapter anything.": this is
                  the first screen App Review opens, and a build without Ask
                  must not lead with it (#2298).
                */}
                <Text style={styles.subtitle}>
                  Everything your chapter needs is already in chat.
                </Text>
                <SignInMoments />
              </View>

              <View style={styles.actions}>
                {messages}
                {renderProvider(layout.primary, true)}
                {layout.secondary
                  ? renderProvider(layout.secondary, false)
                  : null}
                <OnboardingSecondaryButton
                  label="Continue with email"
                  disabled={submitting}
                  onPress={() => {
                    clearMessages();
                    setEmailOpen(true);
                  }}
                />
                {layout.tucked && moreOpen
                  ? renderProvider(layout.tucked, false)
                  : null}
                {layout.tucked && !moreOpen ? (
                  <OnboardingPressable
                    accessibilityRole="button"
                    onPress={() => setMoreOpen(true)}
                    quiet
                    style={styles.textButton}
                  >
                    <Text style={styles.textButtonLabel}>
                      Other ways to sign in
                    </Text>
                  </OnboardingPressable>
                ) : null}
                {appleVisible ? (
                  <Text style={styles.hintText}>{OAUTH_MEMBERSHIP_HINT}</Text>
                ) : null}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingArea>
    </SafeAreaView>
  );
}

/**
 * Sets where the sign-in line breaks, so it never ends on an orphan.
 *
 * "Everything your chapter needs is already in chat." is ~346pt in Figtree
 * 400 at 16pt. The column is the screen less 2 x 24pt padding, so a 375-393pt
 * phone (327-345pt of column) wrapped it with "chat." alone on line 2, and a
 * 402pt one fit it on one line with no room to spare. Capping the text box
 * breaks it at the phrase instead, on every width:
 *
 *   Everything your chapter needs
 *   is already in chat.
 *
 * Measured advance widths (Expo web, Figtree_400Regular 16px, 2026-09-22):
 * "Everything your chapter needs" is 219.5pt and "… needs is" 234.6pt, so any
 * cap between the two breaks after "needs". 227 sits in the middle, leaving
 * ~7pt either side for platform rounding. The copy is owner-approved
 * (writing.md §7, #2298), so this breaks the line and never rewords it.
 * Re-measure if the copy, the role's size or the face changes.
 */
const SUBTITLE_MAX_WIDTH = 227;

/** The actions column's cap, so a tablet doesn't stretch buttons edge to edge. */
const COLUMN_MAX_WIDTH = 400;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The surface colour sits on all three layers: an iOS overscroll bounce
    // shows what is behind the content, and the root Stack ships no navigation
    // theme, so that would be react-navigation's light default.
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    scroll: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: tokens.spacing.xl,
      paddingTop: tokens.spacing.xl,
      paddingBottom: tokens.spacing.lg,
      gap: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    // Takes the height the actions leave and centres the brand in it, so a
    // tall phone shows no dead band between the cards and the buttons.
    brand: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    // brand-identity.md §2: locked emblem B, 52px on radius 14 (`radius.card`).
    // Raster of the canonical tile — never chapter accent.
    mark: {
      width: 52,
      height: 52,
      borderRadius: tokens.radius.card,
      overflow: "hidden",
      marginBottom: tokens.spacing.md,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      marginBottom: tokens.spacing.xs,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
      textAlign: "center",
      maxWidth: SUBTITLE_MAX_WIDTH,
    },
    actions: {
      width: "100%",
      maxWidth: COLUMN_MAX_WIDTH,
      alignSelf: "center",
      gap: tokens.spacing.sm,
    },
    emailColumn: {
      width: "100%",
      maxWidth: COLUMN_MAX_WIDTH,
      alignSelf: "center",
    },
    emailTitle: {
      marginTop: tokens.spacing.md,
      marginBottom: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    button: {
      borderRadius: tokens.radius.control,
      minHeight: tokens.touch.button,
      paddingHorizontal: tokens.spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
    },
    // The platform's own account leads as the one filled button. Light on
    // the dark page, so it reads as the first choice without borrowing house
    // gold, which stays the email form's primary.
    buttonFilled: {
      backgroundColor: tokens.color.text.foreground,
    },
    // Not a style a view takes: the light button's ripple, a shade of the
    // page it sits on.
    filledRipple: {
      color: tint(tokens.color.surface.background, 0.16),
    },
    buttonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    buttonTextFilled: {
      color: tokens.color.surface.background,
    },
    primaryWrap: {
      marginTop: tokens.spacing.lg,
    },
    textButton: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    textButtonLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: {
      marginTop: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    modeRow: {
      marginTop: tokens.spacing.md,
      flexDirection: "row",
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      overflow: "hidden",
    },
    modeButton: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      backgroundColor: tokens.color.surface.surface1,
    },
    // House gold, as every other selected control in the flow is (setup's
    // kind rows and progress ticks, the Terms box). It was info blue, the
    // flow's one blue selection.
    modeButtonActive: {
      backgroundColor: tint(tokens.color.gold.house),
    },
    modeButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    modeButtonTextActive: {
      color: tokens.color.gold.askText,
    },
    errorText: {
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    successText: {
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.success,
    },
    hintText: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textAlign: "center",
    },
    helperText: {
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
