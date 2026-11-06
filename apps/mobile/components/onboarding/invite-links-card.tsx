import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { LinkGlyph } from "@/components/control-glyphs";
import { SectionHeader } from "@/components/list-section";
import type { SharedInvite } from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { webAppOrigin } from "@/lib/onboarding/chapter-wizard/invite-link";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The setup invite step's body (owner pick 2026-11-06, "Share first"): a card
 * that says a link is ready, never the link itself, and the links already
 * shared, newest first, each Not used yet or Joined.
 *
 * The link's token means nothing to a founder, so it isn't drawn. Its host is,
 * so they can see where the link goes. While the next link is being made the
 * card's title reads in muted ink rather than drawing a spinner, so nothing
 * moves. Gold here is the house's, not the chapter's: setup is drawn before
 * the founder is inside the chapter (`spec/behavior/branding.md`).
 */
export function InviteLinksCard({
  hasReady,
  minting,
  shared,
  isJoined,
}: {
  hasReady: boolean;
  minting: boolean;
  shared: readonly SharedInvite[];
  isJoined: (token: string) => boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const host = webAppOrigin().replace(/^https?:\/\//, "");
  const title = hasReady
    ? "Invite link ready"
    : minting
      ? "Making a link"
      : "No link yet";
  const detail =
    hasReady || minting
      ? `${host}, good for 24 hours`
      : "Tap Share invite to try again.";

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View style={styles.tile}>
          <LinkGlyph color={tokens.color.gold.askText} />
        </View>
        <View style={styles.copy}>
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.title, hasReady ? null : styles.titleWaiting]}
          >
            {title}
          </Text>
          <Text style={styles.detail}>{detail}</Text>
        </View>
      </View>

      {shared.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader>Shared</SectionHeader>
          {shared.map((invite, index) => {
            const joined = isJoined(invite.token);
            return (
              <View key={invite.token}>
                {index > 0 ? <View style={styles.rule} /> : null}
                <View style={styles.row}>
                  <View style={styles.rowGlyph}>
                    <LinkGlyph
                      color={tokens.color.text.mutedForeground}
                      size={16}
                    />
                  </View>
                  <Text style={styles.rowName}>{`Link ${invite.number}`}</Text>
                  <Text
                    style={[styles.status, joined ? styles.statusJoined : null]}
                  >
                    {joined ? "Joined" : "Not used yet"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: {
      gap: tokens.spacing.lg,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.md,
    },
    tile: {
      width: 40,
      height: 40,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.gold.askBorder,
      backgroundColor: tokens.color.gold.askFill,
      alignItems: "center",
      justifyContent: "center",
    },
    copy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    titleWaiting: {
      color: tokens.color.text.muted,
    },
    detail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    list: {
      gap: tokens.spacing.xs,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tint(tokens.color.text.foreground, 0.08),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rowGlyph: {
      width: 28,
      height: 28,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    rowName: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    status: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    statusJoined: {
      color: tokens.color.text.mutedForeground,
    },
  });
}
