import { type ComponentType, useMemo, useRef } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useCurrentChapter,
  useCurrentUser,
  useEvents,
  useHiddenUnsetFeatures,
  useInvoices,
  useListChapters,
  useMyGoals,
  useMyPermissions,
  useNowDate,
  usePermissionList,
  useStudySessions,
  useViewerUserId,
} from "@repo/hooks";
import { MEMBER_STATUS_LABEL, untilLabel } from "@repo/hooks/member-status";
import { SignetTokens } from "@repo/theme/signet";
import { can, isBetaOffModule, isModuleEnabled } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { LeadTile } from "@/components/lead-tile";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  ChapterGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  DuesGlyph,
  HostCheckInGlyph,
  InviteGlyph,
  MinutesGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
} from "@/components/more/more-glyphs";
import { StatusChip } from "@/components/status-chip";
import { StatusDot } from "@/components/account/status-dot";
import { StatusSheet } from "@/components/account/status-sheet";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { ErrorState } from "@/components/state-block";
import {
  ProfileDetails,
  ProfileHead,
  ProfileSkeleton,
} from "@/components/you/profile-sections";
import { useOwnStatus } from "@/lib/account/own-status";
import { chapterSettingsAccess } from "@/lib/more/chapter-settings";
import {
  destinationHue,
  type YouDestination,
} from "@/lib/more/destination-hue";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectEventRows } from "@/lib/events/select";
import { selectViewerProfile } from "@/lib/more/profile";
import {
  dueChip,
  selectInvoiceRows,
  selectNextDueInvoice,
} from "@/lib/dues/invoices";
import {
  formatHoursLabel,
  formatHoursValue,
  startOfWeek,
} from "@/lib/study/format";
import { selectSessionHistory } from "@/lib/study/session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The You tab (#3839): the member's own profile and everything that is
 * theirs, on one screen, behind their avatar in the tab bar. It took in s09
 * (the More hub, `canvas-screens.dc.html:326`) and s15 (Profile, `:497`),
 * which were two doors to one person: a profile card on More that pushed
 * Profile, and Profile again from Chat home's avatar menu. Instagram, Slack,
 * Discord and WhatsApp each draw the member as their last tab and open one
 * screen there, the profile on top and the member's own settings and tools
 * under it.
 *
 * ## Order
 *
 * The profile's head (photo, name, points and service hours,
 * `components/you/profile-sections.tsx`), then Status, then the rows the More
 * hub held, then the Admin group, then Details and Bio. The rows come before
 * Details because they are what a member opens the tab for most days; the
 * details are set once and read rarely, so they close the screen.
 *
 * Status (#3845) moved here from the avatar's menu on Chat home, as Discord
 * and Slack keep it on the profile they open from their last tab.
 *
 * ## Editing
 *
 * Tap what you want to change (#3711, Paul 2026-11-07: "The pencil button
 * isn't obvious; drop it"): the name, the bio and the rows that are the
 * member's to set open `EditProfileSheet`, and the photo edits in place. The
 * editable parts are drawn only once the profile has loaded, because a sheet
 * opened on the loading or error state would prefill blanks over fields
 * already set. The rows below the head never wait on the profile.
 *
 * ## Grouping
 *
 * The board draws one group (Study hours through Settings) and an Admin group.
 * The app splits the first in two, chapter tools and then your own Settings
 * and chapter switcher, so the two reachability rows the board never drew
 * (Service hours and Switch chapter, `spec/ui/mobile/navigation.md` § You)
 * sit with their kind instead of trailing the list. The owner approved this
 * layout on 2026-11-04.
 *
 * Notifications are not here: the inbox is the bell on Chat home, beside the
 * unread counts it belongs with (#3362, #3839).
 *
 * **Switch chapter** is the only entry to the chapter picker (#764). When
 * `GET /v1/chapters` is empty the same slot becomes **Create a chapter**
 * (#1084) so a first officer who landed in the tabs still has a door. The
 * picker is deliberately not forced on members whose token lacks an
 * `active_chapter_id` claim (see `lib/auth-gate.ts`), so it needs a door.
 *
 * ## The admin section, and why it may look empty
 *
 * The gate is `usePermissionList()` + `can`, the pattern `host-check-in.tsx`
 * established. The underlying `useMyPermissions` hook is `enabled:
 * !!chapterId`, so a user with no claim gets an empty permission set and the
 * section renders for nobody, Presidents included. It fails closed, which is
 * the right direction.
 *
 * It holds Invite members (`members:invite`, owner ask 2026-11-06: the phone
 * had no way to invite), Host check-in (`events:update`) and Chapter settings
 * (`chapter-config:view` or `roles:manage`, #4074, `lib/more/chapter-settings.ts`),
 * each row drawn only for a role that holds its permission, and the section
 * only when one row is.
 *
 * Canvas labels the section "ADMIN · PRESIDENT", the viewer's role name. No
 * role string is readable on mobile (`/v1/users/me/permissions` returns
 * permissions only), so it reads "Admin".
 *
 * ## Rows nobody has set up
 *
 * Study hours with no active study zone leaves the list for everyone, since
 * zones are made in the web app and the screen could only say so. Documents
 * with nothing in it leaves it for a viewer who can't upload; an officer who
 * can keeps the row, because the upload is on that screen
 * (`useHiddenUnsetFeatures` in `@repo/hooks`; `spec/product/modules.md`
 * § Not-set-up features). Nothing hides until the viewer's permissions, the
 * chapter's modules and the list have all answered, so a row never vanishes
 * on a slow or failed read.
 *
 * ## Trailing statuses
 *
 * Canvas draws "4.0 / 6.0" on Study: the week's real total over the member's
 * weekly study goal, which officers set in Chapter settings (#1062,
 * `useMyGoals`). With no goal the row shows the total with no denominator
 * (see `components/study/week-summary.tsx`). Neither Study nor Dues renders a
 * placeholder while its query is in flight: a row that says "0.0 hrs" for a
 * beat at a member who studied all week is worse than one that says nothing
 * yet.
 */
export default function YouScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const { chapterName } = useChapterBranding();
  const styles = createStyles(tokens);
  // Every row that opens a place leads with that place's tile, in its own
  // fixed hue (`lib/more/destination-hue.ts`; Paul, 2026-11-12). Never the
  // chapter accent: an icon that labels a row doesn't take it (foundations.md
  // §6, "Where the accent goes"). A row that can't be opened now goes grey
  // with its label.
  const tile = (
    Glyph: ComponentType<{ color: string }>,
    place: YouDestination,
    disabled = false,
  ) => {
    const hue = disabled ? undefined : destinationHue(place);
    return (
      <LeadTile on="card" hue={hue} testID={`you-tile-${place}`}>
        <Glyph color={hue ?? tokens.color.text.disabled} />
      </LeadTile>
    );
  };

  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  // Only an error with nothing cached: TanStack keeps `data` through a failed
  // background refetch, and swapping the head out then would drop what was
  // typed into the Edit sheet. The web panel has the same guard.
  const profileFailed = userQuery.isError && userQuery.data === undefined;
  const profileLoaded = !userQuery.isPending && !profileFailed;
  const editSheetRef = useRef<BottomSheetModal>(null);
  const openEditor = () => editSheetRef.current?.present();
  // Both sheets are hosted here, by the screen whose rows open them
  // (`spec/ui/mobile/patterns.md` § Bottom sheets).
  const statusSheetRef = useRef<BottomSheetModal>(null);
  const own = useOwnStatus();
  const status = own?.status ?? "online";
  const statusSub = own?.statusEndsAt
    ? untilLabel(own.statusEndsAt, new Date())
    : (own?.line ?? null);

  const chaptersQuery = useListChapters();
  const hasNoChapters =
    chaptersQuery.isSuccess &&
    Array.isArray(chaptersQuery.data) &&
    chaptersQuery.data.length === 0;
  const permissions = usePermissionList();
  // `can` from @repo/validation, never a bare `includes` — an owner's
  // grant is the wildcard `*`, so a membership test would hide the Admin
  // section from exactly the people who need it.
  const canHost = can("events:update", permissions);
  // Every invite route checks `members:invite`; by default the President's.
  const canInvite = can("members:invite", permissions);
  // The chapter's side of settings (#4074), for whoever has a page there.
  const canChapterSettings = chapterSettingsAccess(permissions).any;

  // The setup gate needs to tell "still loading" from "holds nothing", which
  // `usePermissionList` (`[]` while loading) can't, so it reads the query.
  const permissionsQuery = useMyPermissions();
  const chapter = useCurrentChapter().data;
  const moduleGate = useMemo(
    () =>
      chapter
        ? (key: string) => isModuleEnabled(chapter.enabled_modules, key)
        : undefined,
    [chapter],
  );
  const hiddenFeatures = useHiddenUnsetFeatures(
    permissionsQuery.data?.permissions,
    moduleGate,
  );

  // s22 takes an `eventId`, so the row resolves one rather than leading
  // nowhere. `selectEventRows` already returns upcoming-plus-still-checkable-in,
  // soonest first, so the head of that list is the event an officer would host.
  const eventsQuery = useEvents();
  // `now` ticks rather than being read once inside the memo below: React
  // Query's structural sharing keeps `data` referentially stable across a
  // refetch that returns identical rows, so a captured `new Date()` would
  // keep targeting an event whose check-in window has since closed.
  const now = useNowDate();

  const nextEvent = useMemo(() => {
    if (!canHost) return null;
    return selectEventRows(eventsQuery.data, now)[0] ?? null;
  }, [canHost, eventsQuery.data, now]);

  // The two drawn trailing statuses. Both reads are already cached by the
  // screens they belong to (30s stale windows), so opening You warms them
  // rather than duplicating work.
  const viewerUserId = useViewerUserId();
  const sessionsQuery = useStudySessions();
  // The Dues row hides only while dues is off for every chapter in the beta
  // (`BETA_OFF_MODULES`). A chapter's own dues switch leaves it, so a member
  // can still pay an invoice the chapter already sent
  // (`spec/product/modules.md` § Module disabling behavior).
  const duesOn = !isBetaOffModule("dues");
  // Viewer-filtered server-side, for the reason `dues.tsx` records: unfiltered,
  // this row would pull the whole chapter's ledger onto an officer's device.
  const invoicesQuery = useInvoices(viewerUserId ?? undefined, {
    enabled: duesOn && !!viewerUserId,
  });

  // Keyed on the week boundary rather than the ticking `now`: this
  // narrows and sorts the whole session list, and the answer only changes once a
  // week.
  const weekStart = startOfWeek(now).getTime();
  // With a weekly goal (#1062) the row reads "4.0 / 6.0 hrs", as the board
  // draws it. The goal is its own small read (`GET /v1/goals/mine`, fresh for
  // five minutes), not the whole Activity standing.
  const studyGoal =
    useMyGoals({ enabled: !hiddenFeatures.has("study") }).data?.study ?? null;
  const studyThisWeek = useMemo(() => {
    if (!sessionsQuery.data) return null;
    const minutes = selectSessionHistory(sessionsQuery.data)
      .filter((row) => Date.parse(row.startTime) >= weekStart)
      .reduce((sum, row) => sum + row.totalForegroundMinutes, 0);
    return studyGoal
      ? `${formatHoursValue(minutes)} / ${formatHoursLabel(studyGoal)}`
      : formatHoursLabel(minutes);
  }, [sessionsQuery.data, weekStart, studyGoal]);

  const duesDue = useMemo(() => {
    if (!invoicesQuery.data || !viewerUserId) return null;
    const next = selectNextDueInvoice(
      selectInvoiceRows(invoicesQuery.data, viewerUserId),
    );
    return next ? dueChip(next, now) : null;
  }, [invoicesQuery.data, viewerUserId, now]);

  return (
    <ScreenShell title="You">
      {userQuery.isPending ? (
        <ProfileSkeleton />
      ) : profileFailed ? (
        <ErrorState
          title="Couldn't load your profile"
          body="You're signed in, but we couldn't reach the server."
          onRetry={() => void userQuery.refetch()}
          isRetrying={userQuery.isFetching}
        />
      ) : (
        <ProfileHead profile={profile} onEdit={openEditor} />
      )}

      <ListSection>
        {/* Status first under the head, as Discord and Slack put it at the
            top of the member's own screen: it opens the status sheet. */}
        <ListRow
          label="Status"
          leading={<StatusDot status={status} />}
          value={MEMBER_STATUS_LABEL[status]}
          description={statusSub ?? undefined}
          accessibilityHint="Opens your status and custom status."
          onPress={() => statusSheetRef.current?.present()}
        />
      </ListSection>

      <ListSection>
        {hiddenFeatures.has("study") ? null : (
          <ListRow
            label="Study hours"
            leading={tile(StudyGlyph, "study")}
            value={studyThisWeek}
            accessibilityHint="Opens study hours and session tracking."
            onPress={() => router.push("/study")}
          />
        )}
        <ListRow
          label="Service hours"
          leading={tile(ServiceGlyph, "service")}
          accessibilityHint="Opens your logged service hours."
          onPress={() => router.push("/service-hours")}
        />
        {duesOn ? (
          <ListRow
            label="Dues"
            leading={tile(DuesGlyph, "dues")}
            accessibilityHint="Opens your dues and payment history."
            accessibilityValue={duesDue?.label}
            trailing={
              duesDue ? (
                <StatusChip
                  label={duesDue.label}
                  // foundations.md §5 assigns "overdue" to the destructive role.
                  // A late bill reading the same as an upcoming one is the
                  // confusion the semantic palette exists to prevent.
                  hue={
                    duesDue.state === "past-due"
                      ? tokens.color.semantic.destructive
                      : tokens.color.semantic.warning
                  }
                />
              ) : undefined
            }
            onPress={() => router.push("/dues")}
          />
        ) : null}
        {hiddenFeatures.has("documents") ? null : (
          <ListRow
            label="Documents"
            leading={tile(DocumentsGlyph, "documents")}
            accessibilityHint="Opens the chapter's documents."
            onPress={() => router.push("/documents")}
          />
        )}
        {/* Only on a chapter that keeps minutes in Frapp. */}
        {moduleGate?.("meetings") ? (
          <ListRow
            label="Minutes"
            leading={tile(MinutesGlyph, "minutes")}
            accessibilityHint="Opens your chapter's meeting minutes."
            onPress={() => router.push("/minutes")}
          />
        ) : null}
        <ListRow
          label="Directory"
          leading={tile(DirectoryGlyph, "directory")}
          accessibilityHint="Opens the member directory."
          onPress={() => router.push("/directory")}
        />
      </ListSection>

      <ListSection>
        <ListRow
          label="Settings"
          leading={tile(SettingsGlyph, "settings")}
          accessibilityHint="Opens notifications, quiet hours and your account."
          onPress={() => router.push("/preferences")}
        />
        {hasNoChapters ? (
          <ListRow
            label="Create a chapter"
            leading={tile(ChapterGlyph, "chapter")}
            accessibilityHint="Opens the chapter setup wizard."
            onPress={() => router.push("/(auth)/create-chapter")}
          />
        ) : (
          <ListRow
            label="Switch chapter"
            leading={tile(ChapterGlyph, "chapter")}
            value={chapterName}
            accessibilityHint="Opens the list of chapters you belong to."
            onPress={() =>
              // `from` is how the picker knows You is under it, and so
              // draws `‹ You`: a link that opens it has sign-in under it
              // instead (`app/(auth)/chapter-picker.tsx`). Object form, the
              // shape `lib/routes.spec.ts` matches when a param is involved.
              router.push({
                pathname: "/(auth)/chapter-picker",
                params: { from: "you" },
              })
            }
          />
        )}
      </ListSection>

      {canHost || canInvite || canChapterSettings ? (
        <>
          <SectionHeader>Admin</SectionHeader>
          <ListSection>
            {canInvite ? (
              <ListRow
                label="Invite members"
                leading={tile(InviteGlyph, "invite")}
                accessibilityHint="Opens invites to email or share with new members."
                onPress={() => router.push("/invite")}
              />
            ) : null}
            {canHost ? (
              <ListRow
                label="Host check-in"
                leading={tile(HostCheckInGlyph, "hostCheckIn", !nextEvent)}
                accessibilityValue={
                  nextEvent ? nextEvent.name : "No upcoming event"
                }
                trailing={
                  <Text numberOfLines={1} style={styles.eventName}>
                    {nextEvent ? nextEvent.name : "No upcoming event"}
                  </Text>
                }
                disabled={!nextEvent}
                // A disabled row's hint is not what it would open, which it
                // cannot do; its value already says why.
                accessibilityHint={
                  nextEvent
                    ? "Opens the host check-in display for the next event."
                    : undefined
                }
                onPress={() => {
                  if (!nextEvent) return;
                  // Object form: the only navigation shape `lib/routes.spec.ts`
                  // matches when a param is involved.
                  router.push({
                    pathname: "/host-check-in",
                    params: { eventId: nextEvent.id },
                  });
                }}
              />
            ) : null}
            {canChapterSettings ? (
              <ListRow
                label="Chapter settings"
                leading={tile(SettingsGlyph, "chapterSettings")}
                accessibilityHint="Opens the chapter's accent, chat background and roles."
                onPress={() => router.push("/chapter-settings")}
              />
            ) : null}
          </ListSection>
        </>
      ) : null}

      {profileLoaded ? (
        <ProfileDetails profile={profile} onEdit={openEditor} />
      ) : null}

      {profileLoaded ? (
        <EditProfileSheet ref={editSheetRef} profile={profile} />
      ) : null}
      <StatusSheet ref={statusSheetRef} />
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // A long event name truncates rather than pushing the label off the row.
    eventName: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      maxWidth: 160,
    },
  });
}
