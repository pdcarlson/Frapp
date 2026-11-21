import * as WebBrowser from "expo-web-browser";
import { StyleSheet, Text } from "react-native";
import { termsLine } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { PRIVACY_LINK, TERMS_LINK } from "@/lib/more/legal";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The Terms line under the invite card's buttons (#5625), in place of the
 * checkbox (Paul's pick, 2026-11-19): "By joining you agree to the Terms and
 * Privacy Policy and confirm you're 17 or older." The tap above it is the
 * acceptance, and the join carries it (`joinRedeemBody`). The words are
 * `termsLine` in `@repo/validation`, shared with web's line
 * (`apps/web/components/join/terms-line.tsx`).
 *
 * The two documents open in the in-app browser, as the checkbox's links did.
 */
export function TermsLine({ action }: { action: "continuing" | "joining" }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const words = termsLine(action);
  return (
    <Text style={styles.line}>
      {words.lead}
      <Text
        accessibilityRole="link"
        style={styles.link}
        onPress={() => {
          void WebBrowser.openBrowserAsync(TERMS_LINK.url);
        }}
      >
        {words.terms}
      </Text>
      {words.middle}
      <Text
        accessibilityRole="link"
        style={styles.link}
        onPress={() => {
          void WebBrowser.openBrowserAsync(PRIVACY_LINK.url);
        }}
      >
        {words.privacy}
      </Text>
      {words.tail}
    </Text>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    line: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    link: {
      color: tokens.color.text.foreground,
      textDecorationLine: "underline",
    },
  });
}
