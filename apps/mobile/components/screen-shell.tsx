import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type ScreenShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function ScreenShell({ title, subtitle, children }: ScreenShellProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right", "bottom"]}>
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

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    content: {
      width: "100%",
      maxWidth: 880,
      alignSelf: "center",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.lg,
      gap: tokens.spacing.md,
    },
    header: {
      marginBottom: tokens.spacing.xs,
    },
    title: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
      letterSpacing: -0.4,
    },
    subtitle: {
      marginTop: tokens.spacing.xs,
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    badge: {
      alignSelf: "flex-start",
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.semantic.info),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    badgeText: {
      color: tokens.color.semantic.info,
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    cardTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    cardBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
  });
}
