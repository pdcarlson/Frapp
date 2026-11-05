import { Fragment } from "react";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { LEGAL_ACCEPTANCE_LABEL } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ACCEPTANCE_LINKS } from "@/lib/more/legal";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/** Each document link's slop; see `TermsAcceptance` for the geometry. */
const TERMS_LINK_SLOP = { top: 12, bottom: 12, left: 6, right: 6 };

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
 * inside a chapter yet. The row and the links are quiet lines of the flow
 * (`OnboardingPressable`): a ripple on Android, the text dimmed while held on
 * iOS.
 *
 * The two documents sit on one line under it, each a 20pt line with 12pt of
 * slop above and below, which makes the 44pt minimum. Two gaps keep that slop
 * off its neighbours, since a later sibling is hit-tested first and so wins
 * any overlap:
 * - Between the row and the links, the gap is that same 12, so a link's slop
 *   ends where the row does: a tap at the row's bottom edge ticks the box
 *   rather than opening a document. With an 8pt gap the slop reached 4pt into
 *   the row.
 * - Between lines, when large text wraps the links onto two, the gap is 24,
 *   the top and bottom slop together, so one line's slop ends where the
 *   next's begins. With 8 they overlapped by 4pt, and a tap on the bottom of
 *   `Terms of Service` could open the Privacy Policy under it. Along a line,
 *   the 8pt gap either side of the `·` already clears each link's 6pt side
 *   slop.
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
      <OnboardingPressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted, disabled }}
        accessibilityLabel={LEGAL_ACCEPTANCE_LABEL}
        disabled={disabled}
        onPress={() => onAcceptedChange(!accepted)}
        quiet
        style={styles.row}
      >
        <View
          testID="terms-checkbox"
          style={[styles.checkbox, accepted ? styles.checkboxOn : null]}
        >
          {accepted ? <CheckGlyph color={tokens.color.gold.onHouse} /> : null}
        </View>
        <Text style={styles.label}>{LEGAL_ACCEPTANCE_LABEL}</Text>
      </OnboardingPressable>
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
            <OnboardingPressable
              accessibilityRole="link"
              accessibilityLabel={link.label}
              hitSlop={TERMS_LINK_SLOP}
              onPress={() => {
                void WebBrowser.openBrowserAsync(link.url);
              }}
              quiet
              style={styles.link}
            >
              <Text style={styles.linkText}>{link.label}</Text>
            </OnboardingPressable>
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
    // The links' top slop, so it stops at the checkbox row (see above).
    block: {
      gap: TERMS_LINK_SLOP.top,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
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
      // A wrapped line sits a whole slop's height (top and bottom) under the
      // one above, so their slop meets without overlapping (see above).
      rowGap: TERMS_LINK_SLOP.top + TERMS_LINK_SLOP.bottom,
      columnGap: tokens.spacing.sm,
      // Lines the links up under the label, past the box and its gap.
      paddingLeft: 24 + tokens.spacing.md,
    },
    // The label role sets no line height, and Figtree's own at that size is
    // about 17pt, so the link is held at 20 for its slop to make 44 with.
    link: {
      minHeight:
        tokens.touch.minimum - TERMS_LINK_SLOP.top - TERMS_LINK_SLOP.bottom,
      justifyContent: "center",
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
