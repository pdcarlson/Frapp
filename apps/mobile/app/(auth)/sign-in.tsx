import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { AuthMethod, useAuthSession } from "@/lib/auth-session";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type SessionReadinessRowProps = {
  label: string;
  value: string;
  tone: "ready" | "warning" | "error";
  styles: ReturnType<typeof createStyles>;
};

function SessionReadinessRow({ label, value, tone, styles }: SessionReadinessRowProps) {
  const toneStyle =
    tone === "ready"
      ? styles.readyTone
      : tone === "warning"
        ? styles.warningTone
        : styles.errorTone;

  return (
    <View style={styles.readinessRow}>
      <Text style={styles.readinessLabel}>{label}</Text>
      <Text style={[styles.readinessValue, toneStyle]}>{value}</Text>
    </View>
  );
}

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
  const router = useRouter();
  const { callbackError, isConfigured, sendMagicLink, signInWithPassword } =
    useAuthSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<AuthMethod>("password");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);

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
        // The session lands via onAuthStateChange; (auth)/_layout also redirects
        // on `authenticated`, but navigating here avoids a visible flash of the
        // sign-in form while that propagates.
        router.replace("/(tabs)");
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
      <Text style={styles.title}>Frapp</Text>
      <Text style={styles.subtitle}>
        The Operating System for Greek Life
      </Text>
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

        <View style={styles.readinessCard}>
          <Text style={styles.readinessTitle}>Session readiness</Text>
          <SessionReadinessRow
            label="Auth provider"
            value={isConfigured ? "Configured" : "Not configured"}
            tone={isConfigured ? "ready" : "error"}
            styles={styles}
          />
          <SessionReadinessRow
            label="Session storage"
            value="Device keychain"
            tone="ready"
            styles={styles}
          />
          <SessionReadinessRow
            label="Chapter context"
            value="Resolves after sign-in"
            tone="warning"
            styles={styles}
          />
        </View>
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
    readinessCard: {
      marginTop: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    readinessTitle: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      textTransform: "uppercase",
      letterSpacing: 0.3,
    },
    readinessRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    readinessLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    readinessValue: {
      ...typeRole(tokens.typography.role.caption),
    },
    readyTone: {
      color: tokens.color.semantic.success,
    },
    warningTone: {
      color: tokens.color.semantic.warning,
    },
    errorTone: {
      color: tokens.color.semantic.destructive,
    },
  });
}
