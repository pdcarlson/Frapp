import { ReactNode } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";

type ScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function InfoCard({
  title,
  body,
  badge,
}: {
  title: string;
  body: string;
  badge?: string;
}) {
  return (
    <View style={styles.card}>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: frappTokens.color.surface.canvas,
  },
  content: {
    width: "100%",
    maxWidth: 880,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
  },
  header: {
    marginBottom: 6,
  },
  title: {
    color: frappTokens.color.text.primary,
    fontSize: frappTokens.type.title,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 6,
    color: frappTokens.color.text.secondary,
    fontSize: frappTokens.type.body,
    lineHeight: 22,
  },
  card: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 8,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: frappTokens.color.feedback.infoBackgroundStrong,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: frappTokens.color.feedback.infoTextInteractive,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  cardTitle: {
    color: frappTokens.color.text.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  cardBody: {
    color: frappTokens.color.text.secondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
