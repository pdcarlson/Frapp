import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);

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

function createLoopStateStyles(tokens: SignetTokens) {
  return {
    synced: {
      label: "Synced",
      backgroundColor: tint(tokens.color.semantic.success),
      borderColor: tint(tokens.color.semantic.success, 0.3),
      textColor: tokens.color.semantic.success,
      cardAccent: tint(tokens.color.semantic.success, 0.3),
    },
    pending: {
      label: "Pending",
      backgroundColor: tint(tokens.color.semantic.warning),
      borderColor: tint(tokens.color.semantic.warning, 0.3),
      textColor: tokens.color.semantic.warning,
      cardAccent: tint(tokens.color.semantic.warning, 0.3),
    },
    retry: {
      label: "Retry needed",
      backgroundColor: tint(tokens.color.semantic.destructive),
      borderColor: tint(tokens.color.semantic.destructive, 0.3),
      textColor: tokens.color.semantic.destructive,
      cardAccent: tint(tokens.color.semantic.destructive, 0.3),
    },
    cached: {
      label: "Cached",
      backgroundColor: tint(tokens.color.semantic.info),
      borderColor: tint(tokens.color.semantic.info, 0.3),
      textColor: tokens.color.semantic.info,
      cardAccent: tint(tokens.color.semantic.info, 0.3),
    },
  } as const;
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    card: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      borderLeftWidth: 4,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    category: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    statePill: {
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 3,
    },
    stateText: {
      ...typeRole(tokens.typography.role.caption),
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    actionHint: {
      marginTop: 2,
      ...typeRole(tokens.typography.role.label),
      color: accent,
    },
    summaryCard: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.xl,
      gap: tokens.spacing.xs,
    },
    summaryLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: tokens.color.semantic.info,
    },
    summaryBalance: {
      ...typeRole(tokens.typography.role.display),
      color: tokens.color.text.foreground,
      letterSpacing: -0.6,
    },
    summaryMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    summaryMetaText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
    summaryMetaDivider: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
  });
}
