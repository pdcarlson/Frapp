import { StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { HistoryRow } from "@/components/history-row";
import { formatHoursLabel, formatSessionRange } from "@/lib/study/format";
import type { StudySessionModel } from "@/lib/study/session";
import { isTerminal } from "@/lib/study/session";

/**
 * One row of s10's session history — zone, when, and how long, drawn by the
 * shared `HistoryRow`.
 *
 * The drawn rows all read as clean completions. A real history also contains
 * `EXPIRED` and `LOCATION_INVALID` sessions, which credit **zero** points
 * (`spec/behavior/study-sessions.md` § Points Award). Rendering those with the
 * same silent duration would tell a member they banked time they did not, so a
 * zero-award close says so on the row rather than leaving them to notice the
 * points never arrived.
 */
export interface SessionRowProps {
  session: StudySessionModel;
  zoneName: string | null;
  isLast: boolean;
}

const ZERO_AWARD_NOTE: Partial<Record<StudySessionModel["status"], string>> = {
  EXPIRED: "Ended early · no points",
  LOCATION_INVALID: "Location unconfirmed · no points",
};

export function SessionRow({ session, zoneName, isLast }: SessionRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const range = formatSessionRange(session.startTime, session.endTime);
  const note = ZERO_AWARD_NOTE[session.status] ?? null;
  const meta = [range, note].filter((part): part is string => !!part).join(" · ");
  const duration = formatHoursLabel(session.totalForegroundMinutes);

  return (
    <HistoryRow
      title={zoneName ?? "Study session"}
      meta={meta.length > 0 ? meta : null}
      isLast={isLast}
      trailing={
        <Text
          style={[styles.duration, note ? styles.durationMuted : null]}
          accessibilityLabel={`${duration}${
            isTerminal(session.status) && note ? `, ${note}` : ""
          }`}
        >
          {duration}
        </Text>
      }
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    duration: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    durationMuted: {
      color: tokens.color.text.muted,
    },
  });
}
