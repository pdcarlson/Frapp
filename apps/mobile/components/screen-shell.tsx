import { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type ScreenShellProps = {
  title: string;
  /**
   * Drawn before the title on the title row. Chat home passes the chapter mark
   * (`ChapterMark`), which is the one mobile surface of the chapter's logo
   * (`spec/behavior/branding.md` § Chapter mark). It used to ride in the tab
   * navigator's header, which no screen has since #2485.
   */
  titleMark?: ReactNode;
  subtitle: string;
  /**
   * Trailing control rendered on the title row, right-aligned and vertically
   * centred against the title.
   *
   * Added in S2 because this file freezes afterwards (#937's hotspot protocol)
   * and three drawn screens need it: the ✦ Ask pill on s04 and s06, and the `+`
   * on s08 (spec/ui/mobile/navigation.md:44). Optional, so every existing call
   * site is unaffected.
   */
  headerAction?: ReactNode;
  children: ReactNode;
};

/**
 * The screen frame every drawn tab screen shares: its title row, subtitle and
 * scrolling body. The title is the screen's only heading. The tab layout draws
 * no navigator header (#2485), so the shell also takes the top safe-area inset
 * the header used to absorb.
 */
export function ScreenShell({
  title,
  titleMark,
  subtitle,
  headerAction,
  children,
}: ScreenShellProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            {titleMark}
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {headerAction ? (
              <View style={styles.headerAction}>{headerAction}</View>
            ) : null}
          </View>
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
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    title: {
      flex: 1,
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.title),
      letterSpacing: -0.4,
    },
    headerAction: {
      flexShrink: 0,
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
