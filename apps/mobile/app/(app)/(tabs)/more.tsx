import { useMemo } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import {
  useCurrentChapter,
  useCurrentUser,
  useEvents,
  useHiddenUnsetFeatures,
  useInvoices,
  useListChapters,
  useMyPermissions,
  useMyPoints,
  useNowDate,
  usePermissionList,
  useStudySessions,
  useViewerUserId,
  useOwnAvatarTint,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can, isBetaOffModule, isModuleEnabled } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
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
import { ProfileCard } from "@/components/more/profile-card";
import { StatusChip } from "@/components/status-chip";
import { chapterSettingsAccess } from "@/lib/more/chapter-settings";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectEventRows } from "@/lib/events/select";
import { formatPointsLabel } from "@/lib/more/hub";
import { selectPointsBalance, selectViewerProfile } from "@/lib/more/profile";
import {
  dueChip,
  selectInvoiceRows,
  selectNextDueInvoice,
} from "@/lib/dues/invoices";
import { formatHoursLabel, startOfWeek } from "@/lib/study/format";
import { selectSessionHistory } from "@/lib/study/session";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s09 — More hub (`canvas-screens.dc.html:326`).
 *
 * The drawn anatomy (#1048): a profile card, then grouped lists of rows with a
 * leading duotone glyph, a trailing status where there is one, and a chevron.
 * Rows carry no description line; the board draws none, and the label names
 * the destination.
 *
 * ## Grouping
 *
 * The board draws one group (Study hours through Settings) and an Admin group.
 * The app splits the first in two, chapter tools and then your own Settings
 * and chapter switcher, so the two reachability rows the board never drew
 * (Service hours and Switch chapter, `spec/ui/mobile/navigation.md` § More hub) sit
 * with their kind instead of trailing the list. The owner approved this
 * layout on 2026-11-04.
 *
 * The board's Notifications row is not here: the inbox moved to a bell on
 * Chat home, beside the unread counts it belongs with (#3362, owner decision
 * 2026-11-04; `components/chat/notifications-bell.tsx`).
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
 * permissions only), so it reads "Admin", and the profile card shows no role
 * chip for the same reason.
 *
 * ## Activity
 *
 * Activity was this hub's first row until it became tab 2 on 2026-11-12
 * (#4610). Its count now rides on the tab (`GlassTabBar`).
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
 * Canvas draws "4.0 / 6.0" on Study, but no weekly requirement is modelled
 * anywhere, so the row shows the week's real total with no denominator (see
 * `components/study/week-summary.tsx`). Neither Study nor Dues renders a
 * placeholder while its query is in flight: a row that says "0.0 hrs" for a
 * beat at a member who studied all week is worse than one that says nothing
 * yet.
 */
export default function MoreScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  // Your initials wear the color the chapter sees on them (#3860).
  const ownTint = useOwnAvatarTint();
  const { chapterName } = useChapterBranding();
  const styles = createStyles(tokens);
  // Every row's leading glyph is neutral, member and Admin rows alike: an icon
  // that labels a row never takes the chapter accent (foundations.md §6,
  // "Where the accent goes", 2026-11-05).
  const glyphColor = tokens.color.text.muted;

  // Both reads are shared with s15 (Profile), so opening More warms them.
  const userQuery = useCurrentUser();
  const profile = useMemo(
    () => selectViewerProfile(userQuery.data),
    [userQuery.data],
  );
  const pointsBalance = selectPointsBalance(useMyPoints().data);

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
  // screens they belong to (30s stale windows), so opening More warms them
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
  const studyThisWeek = useMemo(() => {
    if (!sessionsQuery.data) return null;
    const minutes = selectSessionHistory(sessionsQuery.data)
      .filter((row) => Date.parse(row.startTime) >= weekStart)
      .reduce((sum, row) => sum + row.totalForegroundMinutes, 0);
    return formatHoursLabel(minutes);
  }, [sessionsQuery.data, weekStart]);

  const duesDue = useMemo(() => {
    if (!invoicesQuery.data || !viewerUserId) return null;
    const next = selectNextDueInvoice(
      selectInvoiceRows(invoicesQuery.data, viewerUserId),
    );
    return next ? dueChip(next, now) : null;
  }, [invoicesQuery.data, viewerUserId, now]);

  return (
    <ScreenShell title="More">
      <ProfileCard
        displayName={profile?.displayName ?? null}
        initials={profile?.initials ?? "?"}
        photoUrl={profile?.photoUrl ?? null}
        fetchedAt={userQuery.dataUpdatedAt}
        pointsLabel={formatPointsLabel(pointsBalance)}
        tint={ownTint}
      />

      <ListSection>
        {hiddenFeatures.has("study") ? null : (
          <ListRow
            label="Study hours"
            leading={<StudyGlyph color={glyphColor} />}
            value={studyThisWeek}
            accessibilityHint="Opens study hours and session tracking."
            onPress={() => router.push("/study")}
          />
        )}
        <ListRow
          label="Service hours"
          leading={<ServiceGlyph color={glyphColor} />}
          accessibilityHint="Opens your logged service hours."
          onPress={() => router.push("/service-hours")}
        />
        {duesOn ? (
          <ListRow
            label="Dues"
            leading={<DuesGlyph color={glyphColor} />}
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
            leading={<DocumentsGlyph color={glyphColor} />}
            accessibilityHint="Opens the chapter's documents."
            onPress={() => router.push("/documents")}
          />
        )}
        {/* Only on a chapter that keeps minutes in Frapp. */}
        {moduleGate?.("meetings") ? (
          <ListRow
            label="Minutes"
            leading={<MinutesGlyph color={glyphColor} />}
            accessibilityHint="Opens your chapter's meeting minutes."
            onPress={() => router.push("/minutes")}
          />
        ) : null}
        <ListRow
          label="Directory"
          leading={<DirectoryGlyph color={glyphColor} />}
          accessibilityHint="Opens the member directory."
          onPress={() => router.push("/directory")}
        />
      </ListSection>

      <ListSection>
        <ListRow
          label="Settings"
          leading={<SettingsGlyph color={glyphColor} />}
          accessibilityHint="Opens notifications, quiet hours and your account."
          onPress={() => router.push("/preferences")}
        />
        {hasNoChapters ? (
          <ListRow
            label="Create a chapter"
            leading={<ChapterGlyph color={glyphColor} />}
            accessibilityHint="Opens the chapter setup wizard."
            onPress={() => router.push("/(auth)/create-chapter")}
          />
        ) : (
          <ListRow
            label="Switch chapter"
            leading={<ChapterGlyph color={glyphColor} />}
            value={chapterName}
            accessibilityHint="Opens the list of chapters you belong to."
            onPress={() =>
              // `from` is how the picker knows More is under it, and so
              // draws `‹ More`: a link that opens it has sign-in under it
              // instead (`app/(auth)/chapter-picker.tsx`). Object form, the
              // shape `lib/routes.spec.ts` matches when a param is involved.
              router.push({
                pathname: "/(auth)/chapter-picker",
                params: { from: "more" },
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
                leading={<InviteGlyph color={glyphColor} />}
                accessibilityHint="Opens invites to email or share with new members."
                onPress={() => router.push("/invite")}
              />
            ) : null}
            {canHost ? (
              <ListRow
                label="Host check-in"
                leading={<HostCheckInGlyph color={glyphColor} />}
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
                leading={<SettingsGlyph color={glyphColor} />}
                accessibilityHint="Opens the chapter's accent, chat background and roles."
                onPress={() => router.push("/chapter-settings")}
              />
            ) : null}
          </ListSection>
        </>
      ) : null}
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
