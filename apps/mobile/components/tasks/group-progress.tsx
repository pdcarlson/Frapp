import { StyleSheet, Text, View } from "react-native";
import { TASK_AUDIENCE_COPY } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { meterStyles } from "@/components/meter";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * How far a group task's copies are (#5492): who it went to, "3 of 12 done",
 * and the proportion as a meter beside it, as Activity's progress line draws
 * one (`components/meter.tsx`), in the chapter accent and green once every
 * copy is done. The words say the count; the bar shows it at a glance.
 * Drawn on the page, so the meter is named as drawn on `--background`.
 */
export function GroupProgress({
  who,
  done,
  total,
}: {
  /** "Everyone in Philanthropy", or `null` to show the count alone. */
  who: string | null;
  done: number;
  total: number;
}) {
  const { tokens } = useFrappTheme();
  const { accentPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const words = TASK_AUDIENCE_COPY.groupLine(who, done, total);
  return (
    <View style={styles.line} accessible accessibilityLabel={words}>
      <Text style={styles.words}>{words}</Text>
      <View style={styles.track} testID="group-progress-meter">
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(share * 100)}%`,
              backgroundColor:
                share === 1 ? tokens.color.semantic.success : accentPrimary,
            },
          ]}
        />
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const meter = meterStyles(tokens, tokens.color.surface.background);
  return StyleSheet.create({
    line: {
      gap: tokens.spacing.xs,
    },
    words: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    track: meter.track,
    fill: meter.fill,
  });
}
