import { Pressable, StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";

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
          Mobile authentication and chapter selection are being finalized with Supabase session persistence.
        </Text>
        <Pressable style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Continue with Email</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Use Magic Link</Text>
        </Pressable>
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
  primaryButton: {
    marginTop: 16,
    borderRadius: 10,
    backgroundColor: frappTokens.color.brand.royalBlue,
    paddingVertical: 12,
    alignItems: "center",
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
});
