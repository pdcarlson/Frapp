import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";
import { PreviewAuthMethod, usePreviewSession } from "@/lib/preview-session";

type SessionReadinessRowProps = {
  label: string;
  value: string;
  tone: "ready" | "warning" | "error";
};

function SessionReadinessRow({ label, value, tone }: SessionReadinessRowProps) {
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

export default function SignIn() {
  const router = useRouter();
  const { signIn } = usePreviewSession();
  const [email, setEmail] = useState("officer@university.edu");
  const [authMode, setAuthMode] = useState<PreviewAuthMethod>("password");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  function isValidEmailAddress(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handlePreviewSignIn(method: PreviewAuthMethod) {
    if (!isValidEmailAddress(email.trim())) {
      setAuthError("Enter a valid chapter email before continuing.");
      return;
    }

    setSubmitting(true);
    setAuthError(null);

    try {
      await signIn({ email: email.trim().toLowerCase(), method });
      router.replace("/(tabs)");
    } catch {
      setAuthError("Sign-in preview failed. Retry in a moment.");
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
          Session-ready preview mode validates auth states, persistence, and chapter handoff before full Supabase integration.
        </Text>

        <Text style={styles.inputLabel}>Chapter email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@university.edu"
          placeholderTextColor={frappTokens.color.text.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
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

        <Text style={styles.helperText}>
          In preview mode, this action simulates chapter session handoff.
        </Text>
        {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={() => handlePreviewSignIn(authMode)}
          style={[
            styles.primaryButton,
            submitting ? styles.primaryButtonDisabled : null,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {submitting ? "Preparing session..." : "Continue with email"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={() => handlePreviewSignIn("magic_link")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Use magic link</Text>
        </Pressable>

        <View style={styles.readinessCard}>
          <Text style={styles.readinessTitle}>Session readiness</Text>
          <SessionReadinessRow
            label="Network"
            value="Connected"
            tone="ready"
          />
          <SessionReadinessRow
            label="Email validation"
            value="Valid format"
            tone="ready"
          />
          <SessionReadinessRow
            label="Storage"
            value="Provisioning"
            tone="warning"
          />
          <SessionReadinessRow
            label="Chapter context"
            value="Resolves after sign-in"
            tone="warning"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: frappTokens.color.surface.canvas,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: frappTokens.color.text.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: frappTokens.color.text.muted,
    marginBottom: 24,
    textAlign: "center",
  },
  card: {
    backgroundColor: frappTokens.color.surface.card,
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    padding: 20,
    width: "100%",
    maxWidth: 340,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  cardBody: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
  inputLabel: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: frappTokens.color.text.muted,
  },
  input: {
    marginTop: 8,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: frappTokens.color.text.primary,
  },
  modeRow: {
    marginTop: 10,
    flexDirection: "row",
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    overflow: "hidden",
  },
  modeButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    backgroundColor: frappTokens.color.surface.muted,
  },
  modeButtonActive: {
    backgroundColor: frappTokens.color.feedback.infoBackgroundStrong,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: frappTokens.color.text.secondary,
  },
  modeButtonTextActive: {
    color: frappTokens.color.feedback.infoTextInteractive,
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "600",
    color: frappTokens.color.feedback.errorText,
  },
  helperText: {
    marginTop: 10,
    fontSize: 12,
    color: frappTokens.color.text.secondary,
  },
  primaryButton: {
    marginTop: 16,
    borderRadius: frappTokens.radius.md,
    backgroundColor: frappTokens.color.brand.royalBlue,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: frappTokens.color.text.inverse,
    fontWeight: "700",
    fontSize: 14,
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: frappTokens.color.surface.card,
  },
  secondaryButtonText: {
    color: frappTokens.color.text.primary,
    fontWeight: "700",
    fontSize: 14,
  },
  readinessCard: {
    marginTop: 14,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorder,
    backgroundColor: frappTokens.color.feedback.infoBackground,
    padding: 12,
    gap: 8,
  },
  readinessTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: frappTokens.color.feedback.infoTextStrong,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  readinessRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  readinessLabel: {
    fontSize: 12,
    color: frappTokens.color.text.secondary,
  },
  readinessValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  readyTone: {
    color: frappTokens.color.feedback.successText,
  },
  warningTone: {
    color: frappTokens.color.feedback.warningText,
  },
  errorTone: {
    color: frappTokens.color.feedback.errorText,
  },
});
