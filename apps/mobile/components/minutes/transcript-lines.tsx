import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** "Speaker 2: words", split so the speaker can lead. */
const SPEAKER_LINE = /^([^:]{1,40}):\s+([\s\S]*)$/;

/**
 * The meeting's transcript, read on the minutes screen itself (Paul,
 * 2026-11-17: "if you could actually look at the recording itself in the
 * minutes, that would be great"): one turn per line, its speaker leading in
 * a quieter weight, as Otter and Granola show theirs.
 */
export function TranscriptLines({ transcript }: { transcript: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const turns = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (
    <View style={styles.lines}>
      {turns.map((line, index) => {
        const match = SPEAKER_LINE.exec(line);
        return (
          <Text key={index} style={styles.turn} selectable>
            {match ? (
              <>
                <Text style={styles.speaker}>{match[1]}</Text>
                {`  ${match[2]}`}
              </>
            ) : (
              line
            )}
          </Text>
        );
      })}
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
