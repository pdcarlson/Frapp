import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { AuthMethod, useAuthSession } from "@/lib/auth-session";
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
  const { callbackError, isConfigured, sendMagicLink, signInWithPassword, status } =
    useAuthSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMethod>("password");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <View
        style={styles.mark}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={styles.markGlyph}>S</Text>
      </View>
      <Text style={styles.title}>Signet</Text>
      <Text style={styles.subtitle}>Ask your chapter anything.</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sign in to your chapter</Text>
        <Text style={styles.cardBody}>
          Use your chapter email. Most accounts resolve to a single chapter
          automatically; if yours belongs to more than one, you will pick after
          signing in.
        </Text>

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
                authMode === "magic_link" ? styles.modeButtonTextActive : null,
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
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={tokens.color.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
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
          onPress={() => {
            void handleSignIn(authMode);
          }}
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
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    // brand-identity.md §2: the placeholder mark is a house-gold rounded-square
    // tile carrying a bold "S". s01 draws it at 52px on radius 14 — `radius.card`
    // is exactly 14, so this stays token-only. House gold, never the chapter
    // accent: the mark MUST NOT take a chapter's colour.
    mark: {
      width: 52,
      height: 52,
      borderRadius: tokens.radius.card,
      backgroundColor: tokens.color.gold.house,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: tokens.spacing.lg,
    },
    markGlyph: {
      // Sized off the tile, not the type ladder: this is a drawn mark, not text.
      fontSize: 27,
      fontWeight: "700",
      color: tokens.color.gold.onHouse,
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
