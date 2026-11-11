import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The one line a list shows where its rows would be when there are none to
 * show: nothing scheduled, nothing on your plate, a search that matched
 * nothing. It replaces the centered empty card for those cases, so the screen
 * keeps its layout (the points card above Tasks stays put) and says the fact
 * in a sentence. Mobile's half of web's `components/shared/inline-note.tsx`;
 * `components.md` §10 records the one-line state.
 *
 * `action` is the one way out the line offers, drawn as an accent link at the
 * end of the sentence: Clear search, Clear filters, Search all files. It
 * never creates anything; creating lives on the tab bar's + and the screen's
 * floating button, which the sentence can point to instead.
 *
 * Errors and offline keep their cards (`state-block.tsx`), because there the
 * list really can't show anything. The one exception is a list that loaded
 * but is missing a part: its line takes `tone="warning"` ("Couldn't load
 * polls. Pull down to try again."), in the warning hue as web's note draws
 * it, so a part that failed never reads as a part that's empty.
 */
export function InlineNote({
  children,
  action,
  tone = "default",
}: {
  children: ReactNode;
  action?: { label: string; onPress: () => void };
  /**
   * `warning` for a line that says part of the list couldn't load (Activity's
   * "Couldn't load polls"), in the warning hue as web's `text-warning` note,
   * so a failed read never reads like an empty one.
   */
  tone?: "default" | "warning";
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Text style={[styles.note, tone === "warning" ? styles.noteWarning : null]}>
      {children}
      {action ? (
        <>
          {" "}
          <Text
            accessibilityRole="link"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            suppressHighlighting={false}
            style={[styles.action, { color: accent }]}
          >
            {action.label}
          </Text>
        </>
      ) : null}
    </Text>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    note: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.xs,
    },
    noteWarning: {
      color: tokens.color.semantic.warning,
    },
    action: {
      textDecorationLine: "underline",
    },
  });
}
