import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useMeeting } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { AI_SUGGESTION_COPY, taskSeriesLine } from "@repo/validation";
import {
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";
import type { TaskRowModel } from "@/lib/tasks/board";
import { repeatFirstDue } from "@/lib/tasks/task-edit";
import { RepeatGlyph } from "@/components/tasks/repeat-field";

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

/**
 * The minutes a task or a posting was suggested from (#5562), on a line of
 * its own, named as the meeting is called now and opening them; the web's
 * panels have the same row. Nothing shows to someone who can't read those
 * minutes, or once they're deleted.
 */
export function TaskMinutesFact({ meetingId }: { meetingId: string }) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createTaskFactStyles(tokens);
  const router = useRouter();
  const name = useMeeting(meetingId).data?.event_name;
  if (!name) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${AI_SUGGESTION_COPY.taskMinutes}: ${name}`}
      onPress={() =>
        router.push({ pathname: "/minutes-details", params: { id: meetingId } })
      }
      style={({ pressed }) => [styles.lineFact, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.factLabel}>{AI_SUGGESTION_COPY.taskMinutes}</Text>
      <Text style={[styles.factValue, { color: accent }]}>{name}</Text>
    </Pressable>
  );
}

/**
 * How a copy of a repeating task repeats (#5119), on a line of its own under
 * the facts row, as web's task panel says it: the repeat mark and "Every
 * Monday · next Nov 24". Nothing for a task with no live series.
 */
export function TaskRepeatFact({ row }: { row: TaskRowModel }) {
  const { tokens } = useFrappTheme();
  const styles = createTaskFactStyles(tokens);
  const first = repeatFirstDue(row);
  const line = first ? taskSeriesLine(row.series, first, { next: true }) : null;
  if (!line) return null;
  return (
    <View
      style={styles.lineFact}
      accessible
      accessibilityLabel={`Repeats: ${line}`}
    >
      <Text style={styles.factLabel}>Repeats</Text>
      <View style={styles.repeatLine}>
        <RepeatGlyph color={tokens.color.text.mutedForeground} size={14} />
        <Text style={styles.factValue}>{line}</Text>
      </View>
    </View>
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
    lineFact: {
      gap: tokens.spacing.xs,
    },
    repeatLine: {
      flexDirection: "row",
      alignItems: "center",
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
