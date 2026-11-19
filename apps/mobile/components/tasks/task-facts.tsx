import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import {
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The facts row both task screens draw under their chip (#5492, #5570): a
 * task's Due, Points and From, a posting's Due, Points and Steps, each a
 * caption over its value as Linear's issue header lists them, a third of
 * the row each. One home, so the task's screen and a posting's can't drift.
 */
export function TaskFacts({ children }: { children: ReactNode }) {
  const { tokens } = useFrappTheme();
  const styles = createTaskFactStyles(tokens);
  return <View style={styles.facts}>{children}</View>;
}

/** One fact: a caption over its value. */
export function TaskFact({
  label,
  value,
  color = null,
}: {
  label: string;
  value: string;
  /** A status colour for the value, or `null` for the foreground. */
  color?: string | null;
}) {
  const { tokens } = useFrappTheme();
  const styles = createTaskFactStyles(tokens);
  return (
    <View
      style={styles.fact}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.factLabel}>{label}</Text>
      <Text
        style={[styles.factValue, color ? { color } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Either task screen's loading state, on the loaded screen's own shapes: the
 * chip and the facts row. The rest is left out, since each part draws only
 * when the task has one.
 */
export function TaskDetailSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createTaskFactStyles(tokens);
  const { caption, label } = tokens.typography.role;
  return (
    <SkeletonRegion label="Loading task" style={styles.skeleton}>
      <SkeletonBlock
        width={tokens.spacing["3xl"] + tokens.spacing.lg}
        height={tokens.spacing.xl}
        radius={tokens.radius.control}
      />
      <View style={styles.facts}>
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.fact}>
            <SkeletonText role={caption} width="40%" />
            <SkeletonText role={label} width="70%" />
          </View>
        ))}
      </View>
    </SkeletonRegion>
  );
}

/** The facts' styles, and `factLabel` for a fact on a line of its own. */
export function createTaskFactStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    skeleton: {
      gap: tokens.spacing.md,
    },
    facts: {
      flexDirection: "row",
      gap: tokens.spacing.md,
    },
    fact: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    factLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    factValue: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
