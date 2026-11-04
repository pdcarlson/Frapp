import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * An unread count, drawn as s09's Notifications row draws it: a filled pill
 * in the accent. The chapter's primary fill and its paired text color, not
 * house gold, because inside a chapter the accent is the chapter's.
 */
export function CountBadge({ count }: { count: number }) {
  const { tokens } = useFrappTheme();
  const { accentPrimary, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <View style={[styles.badge, { backgroundColor: accentPrimary }]}>
      <Text style={[styles.text, { color: accentOnPrimary }]}>
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    badge: {
      minWidth: tokens.spacing.xl,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs / 2,
      borderRadius: tokens.radius.chip,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
    },
  });
}
