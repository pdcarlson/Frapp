import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LEGAL_ACCEPTANCE_LABEL } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ACCEPTANCE_LINKS } from "@/lib/more/legal";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The Terms checkbox every acceptance surface shares (#2302): the
 * create-chapter wizard, the join screen and the Terms prompt. One component
 * so the owner-approved wording (`LEGAL_ACCEPTANCE_LABEL`) and its links can't
 * drift between them.
 */
export function TermsAcceptance({
  accepted,
  onAcceptedChange,
  disabled = false,
}: {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  disabled?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted, disabled }}
        accessibilityLabel={LEGAL_ACCEPTANCE_LABEL}
        disabled={disabled}
        onPress={() => onAcceptedChange(!accepted)}
        style={styles.row}
      >
        <View style={[styles.checkbox, accepted ? styles.checkboxOn : null]} />
        <Text style={styles.label}>{LEGAL_ACCEPTANCE_LABEL}</Text>
      </Pressable>
      <View style={styles.links}>
        {ACCEPTANCE_LINKS.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            onPress={() => {
              void WebBrowser.openBrowserAsync(link.url);
            }}
          >
            <Text style={styles.linkText}>{link.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
    },
    checkbox: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    checkboxOn: {
      backgroundColor: tokens.color.gold.house,
      borderColor: tokens.color.gold.house,
    },
    label: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    links: {
      gap: tokens.spacing.sm,
    },
    linkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
  });
}
