import { useMemo } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import {
  useCurrentUser,
  useEvents,
  useInvoices,
  useListChapters,
  useMyPoints,
  useNowDate,
  usePermissionList,
  useStudySessions,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  ChapterGlyph,
  DirectoryGlyph,
  DocumentsGlyph,
  DuesGlyph,
  HostCheckInGlyph,
  ServiceGlyph,
  SettingsGlyph,
  StudyGlyph,
} from "@/components/more/more-glyphs";
import { ProfileCard } from "@/components/more/profile-card";
import { StatusChip } from "@/components/status-chip";
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
 * Canvas labels the section "ADMIN · PRESIDENT", the viewer's role name. No
 * role string is readable on mobile (`/v1/users/me/permissions` returns
 * permissions only), so it reads "Admin", and the profile card shows no role
 * chip for the same reason.
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
  const { accent, chapterName } = useChapterBranding();
  const styles = createStyles(tokens);
  // Hub row glyphs take the rest hue, as the web sidebar's do: the accent is
  // the active state (iconography.md §1), and seven accent glyphs down one
  // column were the loudest thing on the screen. Admin rows used `text.muted`
  // and member rows the accent until 2026-11-05; both now read alike.
  const rowGlyph = tokens.color.text.mutedForeground;

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
  // Viewer-filtered server-side, for the reason `dues.tsx` records: unfiltered,
  // this row would pull the whole chapter's ledger onto an officer's device.
  const invoicesQuery = useInvoices(viewerUserId ?? undefined, {
    enabled: !!viewerUserId,
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
        accent={accent}
      />

      <ListSection>
        <ListRow
          label="Study hours"
          leading={<StudyGlyph color={rowGlyph} />}
          value={studyThisWeek}
          accessibilityHint="Opens study hours and session tracking."
          onPress={() => router.push("/study")}
        />
        <ListRow
          label="Service hours"
          leading={<ServiceGlyph color={rowGlyph} />}
          accessibilityHint="Opens your logged service hours."
          onPress={() => router.push("/service-hours")}
        />
        <ListRow
          label="Dues"
          leading={<DuesGlyph color={rowGlyph} />}
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
        <ListRow
          label="Documents"
          leading={<DocumentsGlyph color={rowGlyph} />}
          accessibilityHint="Opens the chapter's documents."
          onPress={() => router.push("/documents")}
        />
        <ListRow
          label="Directory"
          leading={<DirectoryGlyph color={rowGlyph} />}
          accessibilityHint="Opens the member directory."
          onPress={() => router.push("/directory")}
        />
      </ListSection>

      <ListSection>
        <ListRow
          label="Settings"
          leading={<SettingsGlyph color={rowGlyph} />}
          accessibilityHint="Opens notifications, quiet hours and your account."
          onPress={() => router.push("/preferences")}
        />
        {hasNoChapters ? (
          <ListRow
            label="Create a chapter"
            leading={<ChapterGlyph color={rowGlyph} />}
            accessibilityHint="Opens the chapter setup wizard."
            onPress={() => router.push("/(auth)/create-chapter")}
          />
        ) : (
          <ListRow
            label="Switch chapter"
            leading={<ChapterGlyph color={rowGlyph} />}
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

      {canHost ? (
        <>
          <SectionHeader>Admin</SectionHeader>
          <ListSection>
            <ListRow
              label="Host check-in"
              leading={
                <HostCheckInGlyph color={rowGlyph} />
              }
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
