import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { AuthMethod, useAuthSession } from "@/lib/auth-session";
import {
  describeOAuthKickoffError,
  OAUTH_MEMBERSHIP_HINT,
  type OAuthProvider,
} from "@/lib/auth-providers";
import { AppleMark, GoogleMark } from "@/components/auth/oauth-brand-icons";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Supabase auth errors are safe to show verbatim — they are deliberately
 * non-enumerating ("Invalid login credentials" regardless of whether the email
 * exists). Anything without a message falls back to generic copy.
 */
function toAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Sign-in failed. Retry in a moment.";
}

export default function SignIn() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const {
    callbackError,
    isConfigured,
    sendMagicLink,
    signInWithOAuthProvider,
    signInWithPassword,
    status,
  } = useAuthSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMethod>("password");
  const [submitting, setSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState<OAuthProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  if (status === "authenticated") {
    // The auth gate owns the next hop (join / welcome / tabs). Rendering the
    // form for one more frame is the flash this used to paper over by jumping
    // straight to `(tabs)` — which skipped s03.
    return null;
  }

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
    setAuthError(null);
    setMagicLinkSentTo(null);

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
      setAuthError(toAuthErrorMessage(error));
    } finally {
      setSubmitting(false);
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
    setAuthError(null);
    setMagicLinkSentTo(null);

    try {
      await signInWithOAuthProvider(provider);
    } catch (error) {
      setAuthError(describeOAuthKickoffError(error));
    } finally {
      setSubmitting(false);
      setOauthPending(null);
    }
  }

  return (
    // Safe area on every edge: `(auth)` renders with `headerShown: false`, so
    // nothing else keeps the mark off the status bar or the last control off
    // the home indicator once the column is taller than the screen.
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "right", "bottom", "left"]}
    >
      {/*
        The column scrolls. It did not, and on a 375x667 screen (iPhone SE,
        and any iPhone-only app on an iPad, which runs at iPhone size) it is
        ~880pt tall: `justifyContent: "center"` overflows *both* ends rather
        than clamping, so the mark went off the top and "Sign in" off the
        bottom, where nothing could reach it. That is the first screen App
        Review opens. `flexGrow: 1` keeps it centred whenever it does fit
        (the join screen, #2295, is the same shape).

        Keyboard: `automaticallyAdjustKeyboardInsets`, not the
        `KeyboardAvoidingView` the join screen wraps its scroll view in. On
        iOS it insets the scroll view by the keyboard's overlap *and* scrolls
        the focused field above it (RN 0.86
        `RCTScrollViewComponentView._keyboardWillChangeFrame`, fed by the
        focused `TextInput`'s `firstResponderFocus`). A padding
        `KeyboardAvoidingView` only shrinks the viewport, which leaves the
        email field below the fold of a shorter scroll view: out from under
        the keyboard, but still out of sight. Doing both would count the
        keyboard twice. Android gets its default window behaviour, as every
        other `(auth)` form does.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Image
          // Metro asset id. This app has no `*.png` module declaration, so a
          // static ESM import fails `tsc` (TS2307) even though Metro is fine.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require("../../assets/images/icon.png")}
          style={styles.mark}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <Text style={styles.title}>Signet</Text>
        {/*
        The landing's closing line (D8, `spec/ui/landing/README.md`), not the
        brand tagline "Ask your chapter anything.": this is the first screen
        App Review opens, and a build without Ask must not lead with it
        (#2298). The brand tagline returns here in the slice that ships Ask.
      */}
        <Text style={styles.subtitle}>
          Everything your chapter needs is already in chat.
        </Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in to your chapter</Text>
          <Text style={styles.cardBody}>
            Use your chapter email. Most accounts resolve to a single chapter
            automatically; if yours belongs to more than one, you will pick
            after signing in.
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => {
              void handleOAuth("apple");
            }}
            style={[
              styles.oauthButton,
              submitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            {oauthPending === "apple" ? (
              <ActivityIndicator
                color={tokens.color.text.foreground}
                size="small"
              />
            ) : (
              <AppleMark color={tokens.color.text.foreground} />
            )}
            <Text style={styles.oauthButtonText}>
              {oauthPending === "apple"
                ? "Signing in..."
                : "Continue with Apple"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={() => {
              void handleOAuth("google");
            }}
            style={[
              styles.oauthButton,
              submitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            {oauthPending === "google" ? (
              <ActivityIndicator
                color={tokens.color.text.foreground}
                size="small"
              />
            ) : (
              <GoogleMark />
            )}
            <Text style={styles.oauthButtonText}>
              {oauthPending === "google"
                ? "Signing in..."
                : "Continue with Google"}
            </Text>
          </Pressable>
          <Text style={styles.helperText}>{OAUTH_MEMBERSHIP_HINT}</Text>

          <View style={styles.orRow}>
            <View style={styles.orRule} />
            <Text style={styles.orLabel}>or</Text>
            <View style={styles.orRule} />
          </View>

          <Text style={styles.inputLabel}>Chapter email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@university.edu"
            placeholderTextColor={tokens.color.text.muted}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            // Password mode: return moves to the password field, keeping the
            // keyboard up. Magic-link mode has no field after this one, so
            // return sends the link, as the button would.
            returnKeyType={authMode === "password" ? "next" : "send"}
            submitBehavior={
              authMode === "password" ? "submit" : "blurAndSubmit"
            }
            onSubmitEditing={() => {
              if (authMode === "password") passwordRef.current?.focus();
              else submit();
            }}
            style={styles.input}
          />

          <View style={styles.modeRow}>
            <Pressable
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
                  authMode === "password" ? styles.modeButtonTextActive : null,
                ]}
              >
                Password
              </Text>
            </Pressable>
            <Pressable
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
                Magic Link
              </Text>
            </Pressable>
          </View>

          {authMode === "password" ? (
            <>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                placeholderTextColor={tokens.color.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                style={styles.input}
              />
            </>
          ) : (
            <Text style={styles.helperText}>
              We&apos;ll email you a link that signs you in on this device.
            </Text>
          )}

          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
          {/* A dead magic link lands back here; without this the member cannot
            tell a broken link from one they never tapped. */}
          {!authError && callbackError ? (
            <Text style={styles.errorText}>{callbackError}</Text>
          ) : null}
          {magicLinkSentTo ? (
            <Text style={styles.successText}>
              Link sent to {magicLinkSentTo}. Open it on this device to finish
              signing in.
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            disabled={submitting}
            onPress={submit}
            style={[
              styles.primaryButton,
              submitting ? styles.primaryButtonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {submitting
                ? "Signing in..."
                : authMode === "password"
                  ? "Sign in"
                  : "Email me a link"}
            </Text>
          </Pressable>

          {!isConfigured ? (
            <Text style={styles.errorText}>
              EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are not
              set for this build, so sign-in is unavailable.
            </Text>
          ) : null}
        </View>
      </ScrollView>
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
      justifyContent: "center",
      alignItems: "center",
      padding: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    // brand-identity.md §2: locked emblem B, 52px on radius 14 (`radius.card`).
    // Raster of the canonical tile — never chapter accent.
    mark: {
      width: 52,
      height: 52,
      borderRadius: tokens.radius.card,
      overflow: "hidden",
      marginBottom: tokens.spacing.lg,
    },
    title: {
      ...typeRole(tokens.typography.role.display),
      color: tokens.color.text.foreground,
      marginBottom: tokens.spacing.sm,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.muted,
      marginBottom: tokens.spacing.xl,
      textAlign: "center",
      maxWidth: SUBTITLE_MAX_WIDTH,
    },
    // Elevation is a lighter surface, never a shadow (foundations.md §10).
    card: {
      backgroundColor: tokens.color.surface.card,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      padding: tokens.spacing.lg,
      width: "100%",
      maxWidth: 340,
    },
    cardTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    cardBody: {
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    oauthButton: {
      marginTop: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.button,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
    },
    oauthButtonText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    orRow: {
      marginTop: tokens.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    orRule: {
      flex: 1,
      height: 1,
      backgroundColor: tokens.color.border.hairline,
    },
    orLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    inputLabel: {
      marginTop: tokens.spacing.md,
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    input: {
      marginTop: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    modeRow: {
      marginTop: tokens.spacing.sm,
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
    modeButtonActive: {
      backgroundColor: tint(tokens.color.semantic.info),
    },
    modeButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    modeButtonTextActive: {
      color: tokens.color.semantic.info,
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
    helperText: {
      marginTop: tokens.spacing.sm,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    primaryButton: {
      marginTop: tokens.spacing.lg,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.55,
    },
    primaryButtonText: {
      color: tokens.color.gold.onHouse,
      ...typeRole(tokens.typography.role.label),
    },
  });
}
