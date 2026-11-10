import { useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useCurrentUser,
  useMyPoints,
  useServiceEntries,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { PencilGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import { BACK_TO_MORE } from "@/components/back-row";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import {
  PROFILE_PHOTO_SIZE,
  ProfilePhoto,
} from "@/components/profile/profile-photo";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import {
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
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
 * ## Five detail rows, not four different ones
 *
 * Canvas draws Email, Phone, Pledge class and Big brother. Of those the
 * `users` table has only Email: no phone or big-brother column exists, and a
 * pledge class lives on the membership (`members.pledge_class_id`, #3939),
 * which this screen does not draw yet. The
 * rows below are Email plus four of the fields the API's `UpdateUserDto`
 * lets a member edit (major, graduation year, city, company); display name heads the
 * screen and bio gets its own card. Filed.
 *
 * ## Editing
 *
 * Canvas draws an Edit action at the far end of the `‹ More` row, and that is
 * where it sits: it opens `EditProfileSheet` for the name, major, graduation
 * year, bio, city and company (#3387). The photo edits in place (#732):
 * `ProfilePhoto` picks, uploads and confirms it. Edit appears only once the
 * profile has loaded, because a sheet opened on the loading or error state
 * would prefill blanks over fields the member has already set.
 */
export default function ProfileScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const { email: sessionEmail } = useAuthSession();
  const chapterId = useActiveChapterId();

  const userQuery = useCurrentUser();
  const editSheetRef = useRef<BottomSheetModal>(null);
  const viewerUserId = useViewerUserId();
  const pointsQuery = useMyPoints();
  // Scoped to the viewer for the same reason `service-hours.tsx` is: unscoped,
  // this endpoint hands a `service:approve` holder the whole chapter, and this
  // card presents the total as the viewer's own service hours.
  const serviceQuery = useServiceEntries(viewerUserId ?? undefined, undefined, {
    enabled: !!viewerUserId,
  });

  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const pointsBalance = selectPointsBalance(pointsQuery.data);
  // `null` until the entries land, so the card shows an em dash rather than a
  // confident "0 service hrs" beside a correct name and points balance.
  const serviceMinutes = sumApprovedServiceMinutes(serviceQuery.data);
  const serviceHours =
    serviceMinutes === null ? null : formatHours(serviceMinutes);

  // The session's email is the one value available before `/v1/users/me`
  // resolves, and it is the same address — so the row never sits blank while
  // the profile loads.
  const email = profile?.email ?? sessionEmail ?? null;

  if (userQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_MORE} title="Profile">
        <ProfileSkeleton />
      </ScreenShell>
    );
  }

  // Only an error with nothing cached. TanStack keeps `data` through a failed
  // background refetch (a return to the app refetches a stale profile), and
  // bare `isError` would swap in this state over the Edit sheet and drop what
  // was typed. The web panel has the same guard (`profile-panel.tsx`).
  if (userQuery.isError && userQuery.data === undefined) {
    return (
      <ScreenShell back={BACK_TO_MORE} title="Profile">
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
    <ScreenShell
      back={BACK_TO_MORE}
      backAction={
        // A pencil, not the board's "Edit" word: the same back-row slot
        // Documents fills with its upload glyph (components.md § Icon-only
        // actions).
        <IconButton
          label="Edit profile"
          hint="Opens a sheet to edit your name and details."
          onPress={() => editSheetRef.current?.present()}
        >
          <PencilGlyph color={accent} />
        </IconButton>
      }
      title="Profile"
    >
      <View style={styles.identity}>
        <ProfilePhoto
          photoUrl={profile?.photoUrl ?? null}
          fetchedAt={userQuery.dataUpdatedAt}
          initials={profile?.initials ?? "?"}
        />
        <Text style={styles.name}>
          {profile?.displayName ?? "Your profile"}
        </Text>
        {profile?.major ||
        profile?.graduationYear ||
        profile?.currentCompany ? (
          <Text style={styles.identityMeta}>
            {[
              profile.major,
              profile.currentCompany,
              formatGraduationYear(profile.graduationYear),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        ) : null}
      </View>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          {/* Both stats in the foreground text: a number is never the chapter
              accent (foundations.md §6, "Where the accent goes"). */}
          <Text style={styles.statValue}>
            {pointsBalance === null ? "—" : pointsBalance.toLocaleString()}
          </Text>
          <Text style={styles.statLabel}>points</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{serviceHours ?? "—"}</Text>
          <Text style={styles.statLabel}>service hrs</Text>
        </View>
      </View>

      {!chapterId ? (
        // Points are chapter-scoped, so without one the card would sit on a
        // dash forever with nothing explaining why. The claim is absent until
        // a membership exists (and during a hook-off incident), so this is
        // the empty-prod case rather than an edge one.
        <Text style={styles.statNote}>
          Choose a chapter from More → Switch chapter to see your points.
        </Text>
      ) : pointsQuery.isError || serviceQuery.isError ? (
        <Text style={styles.statNote}>
          {pointsQuery.isError && serviceQuery.isError
            ? "Points and service hours couldn't load just now."
            : pointsQuery.isError
              ? "Points couldn't load just now."
              : "Service hours couldn't load just now."}
        </Text>
      ) : null}

      <SectionHeader>Details</SectionHeader>
      <ListSection>
        <ListRow variant="detail" label="Email" value={email ?? "Not set"} />
        <ListRow
          variant="detail"
          label="Major"
          value={profile?.major ?? "Not set"}
        />
        <ListRow
          variant="detail"
          label="Graduation"
          value={
            profile?.graduationYear ? String(profile.graduationYear) : "Not set"
          }
        />
        <ListRow
          variant="detail"
          label="City"
          value={profile?.currentCity ?? "Not set"}
        />
        <ListRow
          variant="detail"
          label="Company"
          value={profile?.currentCompany ?? "Not set"}
        />
      </ListSection>

      {profile?.bio ? (
        <>
          <SectionHeader>Bio</SectionHeader>
          <View style={styles.bioCard}>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        </>
      ) : null}

      <EditProfileSheet ref={editSheetRef} profile={profile} />
    </ScreenShell>
  );
}

/** The four Details rows: Email, Graduation, City, Company. */
const DETAIL_ROWS = 4;

/**
 * The screen's loading state, on the loaded screen's own styles: the photo's
 * circle with the name and meta lines under it, the two stat cards, and the
 * Details list. The Details caption is fixed text, so it is drawn as itself.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function ProfileSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, headline } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading your profile" style={styles.skeletonStack}>
      <View style={styles.identity}>
        <SkeletonBlock
          width={PROFILE_PHOTO_SIZE}
          height={PROFILE_PHOTO_SIZE}
          radius={avatarRadius(PROFILE_PHOTO_SIZE)}
        />
        <SkeletonText role={headline} width="44%" />
        <SkeletonText role={caption} width="30%" />
      </View>

      <View style={styles.statRow}>
        {[0, 1].map((index) => (
          <View key={index} style={styles.statCard}>
            <SkeletonText role={headline} width="36%" />
            <SkeletonText role={caption} width="48%" />
          </View>
        ))}
      </View>

      <SectionHeader>Details</SectionHeader>
      <ListSection>
        {Array.from({ length: DETAIL_ROWS }, (_, index) => (
          <ListRowSkeleton key={index} index={index} variant="detail" />
        ))}
      </ListSection>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // `ScreenShell`'s gap, which spaces the loaded screen's blocks.
    skeletonStack: {
      gap: tokens.spacing.md,
    },
    identity: {
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.md,
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
      // The Details list's tone (`card`, as every grouped list since
      // 2026-11-05), as s15 draws both in one.
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
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
    },
    bioText: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
  });
}
