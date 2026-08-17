import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  useActiveChapterId,
  useCurrentUser,
  useMyPoints,
  useServiceEntries,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { ErrorState, SkeletonLines } from "@/components/state-block";
import { useAuthSession } from "@/lib/auth-session";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  formatGraduationYear,
  formatHours,
  selectPointsBalance,
  selectViewerProfile,
  sumApprovedServiceMinutes,
} from "@/lib/more/profile";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s15 — Profile (`canvas-screens.dc.html:497`).
 *
 * ## Two stat cards, not three
 *
 * Canvas draws points, service hours, and "96% attendance". The third is not
 * built and is not buildable by a member: `POST /v1/reports/attendance` is a
 * chapter-wide report generator gated on `reports:export`, its rows carry
 * `member_name` and no `user_id`, it takes no per-member filter, and there is
 * no denominator of events a member owed. `spec/ui/mobile/screens.md` also
 * records that reports stay web-only. Filed rather than invented.
 *
 * ## Four detail rows, not four different ones
 *
 * Canvas draws Email, Phone, Pledge class and Big brother. Only Email exists —
 * the `users` table has no phone, pledge class, or big-brother column, and
 * `UpdateUserSchema` names the complete set of editable fields. The rows below
 * are that set. Filed.
 *
 * ## No Edit action
 *
 * Canvas draws one. Editing here would mean a form plus an avatar picker, and
 * no image picker is a dependency of this app (`package.json` is frozen under
 * #937's hotspot protocol). Profile editing stays on the web dashboard for this
 * slice. TODO-DESIGN: the Edit affordance and its sheet.
 */
export default function ProfileScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const { email: sessionEmail } = useAuthSession();
  const chapterId = useActiveChapterId();

  const userQuery = useCurrentUser();
  const pointsQuery = useMyPoints();
  const serviceQuery = useServiceEntries();

  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const pointsBalance = selectPointsBalance(pointsQuery.data);
  const serviceHours = formatHours(sumApprovedServiceMinutes(serviceQuery.data));

  // The session's email is the one value available before `/v1/users/me`
  // resolves, and it is the same address — so the row never sits blank while
  // the profile loads.
  const email = profile?.email ?? sessionEmail ?? null;

  if (userQuery.isPending) {
    return (
      <ScreenShell title="Profile" subtitle="Your membership and chapter record.">
        <SkeletonLines lines={4} showTile />
      </ScreenShell>
    );
  }

  if (userQuery.isError) {
    return (
      <ScreenShell title="Profile" subtitle="Your membership and chapter record.">
        <ErrorState
          title="Couldn't load your profile"
          body="You're signed in, but we couldn't reach the server."
          onRetry={() => void userQuery.refetch()}
          isRetrying={userQuery.isFetching}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Profile" subtitle="Your membership and chapter record.">
      <View style={styles.identity}>
        <View style={[styles.avatar, { borderColor: accent }]}>
          <Text style={[styles.avatarText, { color: accent }]}>
            {profile?.initials ?? "?"}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.displayName ?? "Your profile"}</Text>
        {profile?.graduationYear || profile?.currentCompany ? (
          <Text style={styles.identityMeta}>
            {[profile.currentCompany, formatGraduationYear(profile.graduationYear)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: accent }]}>
            {pointsBalance === null ? "—" : pointsBalance.toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>points</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{serviceHours}</Text>
          <Text style={styles.statLabel}>service hrs</Text>
        </View>
      </View>

      {!chapterId ? (
        // Points are chapter-scoped, so without one the card would sit on a
        // dash forever with nothing explaining why. No token carries an
        // `active_chapter_id` claim while #805 is open, so this is the common
        // case in production rather than an edge one.
        <Text style={styles.statNote}>
          Choose a chapter from More → Chapter to see your points.
        </Text>
      ) : pointsQuery.isError ? (
        <Text style={styles.statNote}>
          Points couldn&apos;t load just now. Everything else is up to date.
        </Text>
      ) : null}

      <SectionHeader>Details</SectionHeader>
      <ListSection>
        <ListRow label="Email" value={email ?? "Not set"} />
        <ListRow
          label="Graduation"
          value={profile?.graduationYear ? String(profile.graduationYear) : "Not set"}
        />
        <ListRow label="City" value={profile?.currentCity ?? "Not set"} />
        <ListRow label="Company" value={profile?.currentCompany ?? "Not set"} />
      </ListSection>

      {profile?.bio ? (
        <>
          <SectionHeader>Bio</SectionHeader>
          <View style={styles.bioCard}>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        </>
      ) : null}

      <Text style={styles.footnote}>
        Edit your profile and photo on the web dashboard.
      </Text>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  const avatarSize = 84;
  return StyleSheet.create({
    identity: {
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.md,
    },
    avatar: {
      width: avatarSize,
      height: avatarSize,
      borderRadius: avatarRadius(avatarSize),
      borderWidth: 1,
      backgroundColor: tokens.color.gold.askFill,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      ...typeRole(tokens.typography.role.headline),
    },
    name: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    identityMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    statRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    statCard: {
      flex: 1,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    statValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    statLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    statNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.xs,
    },
    bioCard: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      padding: tokens.spacing.lg,
    },
    bioText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    footnote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
