import { StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { useFrappTheme } from "@/lib/theme";

export type TaskLoopState = "synced" | "pending" | "retry" | "cached";

type TaskLoopCardProps = {
  category: string;
  title: string;
  body: string;
  state: TaskLoopState;
  meta?: string;
  actionHint?: string;
};

export function TaskLoopCard({
  category,
  title,
  body,
  state,
  meta,
  actionHint,
}: TaskLoopCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const loopStateStyles = createLoopStateStyles(tokens);
  const stateStyle = loopStateStyles[state];

  return (
    <View style={[styles.card, { borderLeftColor: stateStyle.cardAccent }]}>
      <View style={styles.headerRow}>
        <Text style={styles.category}>{category}</Text>
        <View
          style={[
            styles.statePill,
            {
              backgroundColor: stateStyle.backgroundColor,
              borderColor: stateStyle.borderColor,
            },
          ]}
        >
          <Text style={[styles.stateText, { color: stateStyle.textColor }]}>
            {stateStyle.label}
          </Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      {actionHint ? <Text style={styles.actionHint}>{actionHint}</Text> : null}
    </View>
  );
}

type FeedSummaryCardProps = {
  balance: string;
  rank: string;
  period: string;
};

export function FeedSummaryCard({
  balance,
  rank,
  period,
}: FeedSummaryCardProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>Point balance</Text>
      <Text style={styles.summaryBalance}>{balance}</Text>
      <View style={styles.summaryMetaRow}>
        <Text style={styles.summaryMetaText}>Rank: {rank}</Text>
        <Text style={styles.summaryMetaDivider}>•</Text>
        <Text style={styles.summaryMetaText}>{period}</Text>
      </View>
    </View>
  );
}

function createLoopStateStyles(tokens: FrappTokens) {
  return {
    synced: {
      label: "Synced",
      backgroundColor: tokens.color.feedback.successBackground,
      borderColor: tokens.color.feedback.successBorder,
      textColor: tokens.color.feedback.successText,
      cardAccent: tokens.color.feedback.successBorder,
    },
    pending: {
      label: "Pending",
      backgroundColor: tokens.color.feedback.warningBackground,
      borderColor: tokens.color.feedback.warningBorder,
      textColor: tokens.color.feedback.warningText,
      cardAccent: tokens.color.feedback.warningBorder,
    },
    retry: {
      label: "Retry needed",
      backgroundColor: tokens.color.feedback.errorBackground,
      borderColor: tokens.color.feedback.errorBorder,
      textColor: tokens.color.feedback.errorText,
      cardAccent: tokens.color.feedback.errorBorder,
    },
    cached: {
      label: "Cached",
      backgroundColor: tokens.color.feedback.infoBackgroundStrong,
      borderColor: tokens.color.feedback.infoBorderStrong,
      textColor: tokens.color.feedback.infoTextInteractive,
      cardAccent: tokens.color.feedback.infoBorderStrong,
    },
  } as const;
}

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      borderLeftWidth: 4,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    category: {
      fontSize: tokens.type.label - 1,
      fontWeight: "700",
      color: tokens.color.text.muted,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    statePill: {
      borderRadius: 999,
      borderWidth: 1,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    stateText: {
      fontSize: tokens.type.label - 1,
      fontWeight: "700",
    },
    title: {
      fontSize: 16,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    meta: {
      fontSize: tokens.type.meta,
      lineHeight: 18,
      color: tokens.color.text.muted,
    },
    actionHint: {
      marginTop: 2,
      fontSize: tokens.type.meta,
      fontWeight: "600",
      color: tokens.color.brand.royalBlue,
    },
    summaryCard: {
      borderRadius: tokens.radius.xl,
      borderWidth: 1,
      borderColor: tokens.color.feedback.infoBorder,
      backgroundColor: tokens.color.feedback.infoBackground,
      padding: tokens.spacing.xl,
      gap: 6,
    },
    summaryLabel: {
      fontSize: tokens.type.label,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: tokens.color.feedback.infoText,
    },
    summaryBalance: {
      fontSize: 30,
      fontWeight: "800",
      color: tokens.color.feedback.infoTextStrong,
      letterSpacing: -0.6,
    },
    summaryMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    summaryMetaText: {
      fontSize: tokens.type.meta,
      fontWeight: "600",
      color: tokens.color.feedback.infoText,
    },
    summaryMetaDivider: {
      fontSize: tokens.type.meta,
      color: tokens.color.feedback.infoText,
    },
  });
}
