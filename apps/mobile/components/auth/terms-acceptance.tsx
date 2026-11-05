import { Fragment } from "react";
import * as WebBrowser from "expo-web-browser";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { LEGAL_ACCEPTANCE_LABEL } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ACCEPTANCE_LINKS } from "@/lib/more/legal";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The Terms checkbox every acceptance surface shares (#2302): the
 * create-chapter wizard, the join screen and the Terms prompt. One component
 * so the owner-approved wording (`LEGAL_ACCEPTANCE_LABEL`) and its links can't
 * drift between them.
 *
 * Drawn as components.md § Checkbox draws one: a 24pt box, ticked with a
 * check in the fill's own ink, while the whole row is the 44pt target. It was
 * a 44pt square that filled solid gold with no check, which read as a button
 * rather than a ticked box. House gold, since none of the three screens is
 * inside a chapter yet.
 *
 * The two documents sit on one line under it, each with slop that brings its
 * line of text up to the 44pt minimum.
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
        style={({ pressed }) => [
          styles.row,
          pressed && !disabled ? styles.pressed : null,
        ]}
      >
        <View
          testID="terms-checkbox"
          style={[styles.checkbox, accepted ? styles.checkboxOn : null]}
        >
          {accepted ? <CheckGlyph color={tokens.color.gold.onHouse} /> : null}
        </View>
        <Text style={styles.label}>{LEGAL_ACCEPTANCE_LABEL}</Text>
      </Pressable>
      <View style={styles.links}>
        {ACCEPTANCE_LINKS.map((link, index) => (
          <Fragment key={link.url}>
            {index > 0 ? (
              <Text
                style={styles.separator}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                ·
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={link.label}
              // A 20pt line of label text; 12 above and below makes 44.
              hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
              onPress={() => {
                void WebBrowser.openBrowserAsync(link.url);
              }}
              style={({ pressed }) => (pressed ? styles.pressed : null)}
            >
              <Text style={styles.linkText}>{link.label}</Text>
            </Pressable>
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** components.md § Checkbox: a 2.2px check, round caps and joins. */
function CheckGlyph({ color }: { color: string }) {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
      <Path
        d="M3.5 8.5l3 3 6-7"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    block: {
      gap: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    pressed: {
      opacity: 0.7,
    },
    checkbox: {
      width: 24,
      height: 24,
      // components.md § Checkbox's 7; no radius token holds it.
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: tint(tokens.color.text.foreground, 0.25),
      alignItems: "center",
      justifyContent: "center",
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
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: tokens.spacing.sm,
      // Lines the links up under the label, past the box and its gap.
      paddingLeft: 24 + tokens.spacing.md,
    },
    separator: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    linkText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.house,
    },
  });
}
