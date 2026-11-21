import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useCurrentUser, usePickableRoles } from "@repo/hooks";
import type { SignetTokens } from "@repo/theme/signet";
import { WELCOME_CARD_COPY } from "@repo/validation";
import { BACK_TO_CHAT } from "@/components/back-row";
import { ProfilePhoto } from "@/components/profile/profile-photo";
import { PickRolesList } from "@/components/roles/pick-roles-list";
import { ScreenShell } from "@/components/screen-shell";
import { ChatDensityOptions } from "@/components/settings/chat-density-sheet";
import { initialsFor } from "@/lib/more/narrow";
import { selectViewerProfile } from "@/lib/more/profile";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Finish your profile (#5627), opened from the welcome card: the three things
 * s03 no longer asks, each the control its own place uses (Profile's photo,
 * the Directory's Add roles, Settings' Chat density), so a change here is the
 * same change there.
 *
 * A screen of its own, not a sheet (Paul 2026-11-20 on the first build: "not
 * sure a sheet is the move here"): it holds three sections and the roles list
 * can be long, and Slack's "Complete your profile" and Discord's profile
 * prompt both open a full page rather than a panel over the chat.
 */
export default function FinishProfileScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const { roles } = usePickableRoles();
  return (
    <ScreenShell
      back={BACK_TO_CHAT}
      title={WELCOME_CARD_COPY.profileTitle}
      subtitle={WELCOME_CARD_COPY.profileLede}
    >
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.section}>
          {WELCOME_CARD_COPY.photo}
        </Text>
        <View style={styles.photo}>
          <ProfilePhoto
            photoUrl={profile?.photoUrl ?? null}
            fetchedAt={userQuery.dataUpdatedAt}
            initials={initialsFor(profile?.displayName ?? null)}
          />
        </View>
        {roles.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.section}>
              {WELCOME_CARD_COPY.roles}
            </Text>
            <PickRolesList roles={roles} />
          </>
        ) : null}
        <Text accessibilityRole="header" style={styles.section}>
          {WELCOME_CARD_COPY.display}
        </Text>
        <ChatDensityOptions />
      </View>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: { gap: tokens.spacing.md },
    section: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.sm,
    },
    photo: { alignItems: "flex-start" },
  });
}
