import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";

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
          defaultValue="officer@university.edu"
          placeholder="you@university.edu"
          placeholderTextColor={frappTokens.color.text.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={styles.input}
        />

        <View style={styles.modeRow}>
          <View style={[styles.modeButton, styles.modeButtonActive]}>
            <Text style={[styles.modeButtonText, styles.modeButtonTextActive]}>
              Password
            </Text>
          </View>
          <View style={styles.modeButton}>
            <Text style={styles.modeButtonText}>Magic Link</Text>
          </View>
        </View>

        <Text style={styles.helperText}>
          In preview mode, this action simulates chapter session handoff.
        </Text>

        <Link href="/(tabs)" asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Continue with email</Text>
          </Pressable>
        </Link>
        <Link href="/(tabs)" asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Use magic link</Text>
          </Pressable>
        </Link>

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
    backgroundColor: "#DBEAFE",
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: frappTokens.color.text.secondary,
  },
  modeButtonTextActive: {
    color: "#1D4ED8",
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
    borderRadius: 10,
    backgroundColor: frappTokens.color.brand.royalBlue,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  secondaryButton: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  secondaryButtonText: {
    color: "#1E293B",
    fontWeight: "700",
    fontSize: 14,
  },
  readinessCard: {
    marginTop: 14,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: 12,
    gap: 8,
  },
  readinessTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1E40AF",
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
    color: "#166534",
  },
  warningTone: {
    color: "#92400E",
  },
  errorTone: {
    color: frappTokens.color.feedback.errorText,
  },
});
