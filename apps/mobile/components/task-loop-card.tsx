import { StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";

const LOOP_STATE_STYLES = {
  synced: {
    label: "Synced",
    backgroundColor: frappTokens.color.feedback.successBackground,
    borderColor: frappTokens.color.feedback.successBorder,
    textColor: frappTokens.color.feedback.successText,
  },
  pending: {
    label: "Pending",
    backgroundColor: frappTokens.color.feedback.warningBackground,
    borderColor: frappTokens.color.feedback.warningBorder,
    textColor: frappTokens.color.feedback.warningText,
  },
  retry: {
    label: "Retry needed",
    backgroundColor: frappTokens.color.feedback.errorBackground,
    borderColor: frappTokens.color.feedback.errorBorder,
    textColor: frappTokens.color.feedback.errorText,
  },
  cached: {
    label: "Cached",
    backgroundColor: frappTokens.color.feedback.infoBackgroundStrong,
    borderColor: frappTokens.color.feedback.infoBorderStrong,
    textColor: frappTokens.color.feedback.infoTextInteractive,
  },
} as const;

export type TaskLoopState = keyof typeof LOOP_STATE_STYLES;

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
  const stateStyle = LOOP_STATE_STYLES[state];

  return (
    <View style={styles.card}>
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

const styles = StyleSheet.create({
  card: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  category: {
    fontSize: frappTokens.type.label - 1,
    fontWeight: "700",
    color: frappTokens.color.text.muted,
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
    fontSize: frappTokens.type.label - 1,
    fontWeight: "700",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
  meta: {
    fontSize: frappTokens.type.meta,
    lineHeight: 18,
    color: frappTokens.color.text.muted,
  },
  actionHint: {
    marginTop: 2,
    fontSize: frappTokens.type.meta,
    fontWeight: "600",
    color: frappTokens.color.brand.royalBlue,
  },
  summaryCard: {
    borderRadius: frappTokens.radius.xl,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorder,
    backgroundColor: frappTokens.color.feedback.infoBackground,
    padding: frappTokens.spacing.xl,
    gap: 6,
  },
  summaryLabel: {
    fontSize: frappTokens.type.label,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: frappTokens.color.feedback.infoText,
  },
  summaryBalance: {
    fontSize: 30,
    fontWeight: "800",
    color: frappTokens.color.feedback.infoTextStrong,
    letterSpacing: -0.6,
  },
  summaryMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryMetaText: {
    fontSize: frappTokens.type.meta,
    fontWeight: "600",
    color: frappTokens.color.feedback.infoText,
  },
  summaryMetaDivider: {
    fontSize: frappTokens.type.meta,
    color: frappTokens.color.feedback.infoText,
  },
});
