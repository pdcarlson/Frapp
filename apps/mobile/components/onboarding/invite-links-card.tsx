import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { LinkGlyph } from "@/components/control-glyphs";
import { SectionHeader } from "@/components/list-section";
import type { SharedInvite } from "@/lib/onboarding/chapter-wizard/use-invite-shares";
import { webAppHost } from "@/lib/onboarding/chapter-wizard/invite-link";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The setup invite step's body (owner pick 2026-11-06, "Share first"): a card
 * that says what a press of Share invite sends, never a link itself, and the
 * links already shared, newest first, each Not used yet or Joined.
 *
 * A token means nothing to a founder, so none is drawn. The host is, so they
 * can see where a link goes. In setup the tile's gold is the house's, not the
 * chapter's: setup is drawn before the founder is inside the chapter
 * (`spec/behavior/branding.md`). The Invite members screen
 * (`app/(app)/invite.tsx`) is inside one, so it passes the chapter accent as
 * `tile`, and its Share invite button as `action`, which sits between the
 * card and the list so the list can grow without pushing the button away.
 * That screen lists its invites itself (`InvitedList`), so it passes no
 * `shared`.
 */
export function InviteLinksCard({
  shared = [],
  isJoined = () => false,
  tile,
  action,
}: {
  /**
   * The links shared on this visit, listed under Shared. The Invite members
   * screen leaves it out: its Invited list holds every link, so it would
   * list each one twice.
   */
  shared?: readonly SharedInvite[];
  isJoined?: (token: string) => boolean;
  /** The link tile's fill, border and glyph. Defaults to house gold. */
  tile?: { fill: string; border: string; ink: string };
  action?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const tileColors = tile ?? {
    fill: tokens.color.gold.askFill,
    border: tokens.color.gold.askBorder,
    ink: tokens.color.gold.askText,
  };

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <View
          style={[
            styles.tile,
            {
              backgroundColor: tileColors.fill,
              borderColor: tileColors.border,
            },
          ]}
        >
          <LinkGlyph color={tileColors.ink} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title}>A new link for each person</Text>
          <Text style={styles.detail}>
            {`${webAppHost()}, good for 24 hours`}
          </Text>
        </View>
      </View>

      {action}

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
