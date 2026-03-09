import { ReactNode } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { useFrappTheme } from "@/lib/theme";

type ScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.canvas,
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
      color: tokens.color.text.primary,
      fontSize: tokens.type.title,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    subtitle: {
      marginTop: 6,
      color: tokens.color.text.secondary,
      fontSize: tokens.type.body,
      lineHeight: 22,
    },
    card: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    badge: {
      alignSelf: "flex-start",
      borderRadius: 999,
      backgroundColor: tokens.color.feedback.infoBackgroundStrong,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    badgeText: {
      color: tokens.color.feedback.infoTextInteractive,
      fontSize: tokens.type.label - 1,
      fontWeight: "700",
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    cardTitle: {
      color: tokens.color.text.primary,
      fontSize: tokens.type.section - 2,
      fontWeight: "700",
    },
    cardBody: {
      color: tokens.color.text.secondary,
      fontSize: tokens.type.body - 1,
      lineHeight: 20,
    },
  });
}
