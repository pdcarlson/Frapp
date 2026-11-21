import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { transcriptTurns } from "@repo/validation";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The meeting's transcript, on its own screen (`minutes-transcript.tsx`):
 * one turn per line, its speaker leading in a quieter weight
 * (`transcriptTurns`).
 */
export function TranscriptLines({ transcript }: { transcript: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.lines}>
      {transcriptTurns(transcript).map((turn, index) => (
        <Text key={index} style={styles.turn} selectable>
          {turn.speaker ? (
            <>
              <Text style={styles.speaker}>{turn.speaker}</Text>
              {`  ${turn.text}`}
            </>
          ) : (
            turn.text
          )}
        </Text>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    lines: {
      gap: tokens.spacing.sm,
    },
    turn: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    speaker: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
  });
}
