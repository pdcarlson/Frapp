import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The one line a list shows where its rows would be when there are none to
 * show: nothing scheduled, nothing on your plate. It replaces the centered
 * empty card for those cases, so the screen keeps its layout (the points card
 * above Tasks stays put) and says the fact in a sentence. Mobile's half of
 * web's `components/shared/inline-note.tsx`; `components.md` §10 records the
 * one-line state.
 *
 * Errors and offline keep their cards (`state-block.tsx`), because there the
 * list really can't show anything.
 */
export function InlineNote({ children }: { children: ReactNode }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <Text style={styles.note}>{children}</Text>;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    note: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.xs,
    },
  });
}
