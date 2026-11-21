import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The host's quiet "Check myself in" (2026-11-17), under Host check-in on the
 * event and under the code on s22: one tap, no code, since the host's own
 * phone is the one showing it (`useOneTapCheckIn`). One component, so the two
 * places say and do the same thing.
 */
export function SelfCheckInLink({
  accent,
  pending,
  message,
  onPress,
}: {
  accent: string;
  pending: boolean;
  message: string | null;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: pending }}
        disabled={pending}
        onPress={onPress}
        style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.linkText, { color: accent }]}>
          {pending ? "Checking you in…" : "Check myself in"}
        </Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    wrap: {
      alignItems: "center",
    },
    // A text action at the 44pt floor, quieter than the button above it.
    link: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    linkText: {
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
    message: {
      textAlign: "center",
      color: tokens.color.semantic.destructive,
      ...typeRole(tokens.typography.role.caption),
    },
  });
}
