import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useCurrentUser,
  useServiceEntries,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { HeaderAddButton } from "@/components/header-add-button";
import { HistoryRow } from "@/components/history-row";
import { SectionHeader } from "@/components/list-section";
import { LogHoursSheet } from "@/components/service-hours/log-hours-sheet";
import { StatusChip } from "@/components/status-chip";
import {
  EmptyState,
  ErrorState,
  SkeletonLines,
} from "@/components/state-block";
import {
  selectServiceEntryRows,
  summarizeServiceEntries,
  type ServiceEntryStatus,
} from "@/lib/more/service-hours";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Service hours: the member's approved total, their history, and the s20 "Log
 * service hours" sheet (`components/service-hours/log-hours-sheet.tsx`).
 *
 * The list is the member's own history: `GET /v1/service-entries` pins a
 * non-admin's read to their own id server-side, so no client-side filter makes
 * that true and none pretends to.
 *
 * Drawn like its sibling "my numbers" screens, s10 Study and s11 Dues: a
 * sentence-case caption over a display-role figure, with a status chip on the
 * caption row, then the board's unboxed history rows (`HistoryRow`). The board
 * never drew this screen, so the siblings are the reference.
 */
export default function ServiceHoursScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const sheetRef = useRef<BottomSheetModal>(null);

  // Scoped to the viewer on purpose. Unscoped, this endpoint returns the whole
  // chapter to anyone holding `service:approve` — so an officer saw every
  // member's entries in a list whose rows carry no name, and the "Approved"
  // card totalled the chapter's minutes under a screen that says "you've
  // logged". `null` is "/v1/users/me has not answered yet", so the request
  // waits rather than firing once unscoped.
  const viewerUserId = useViewerUserId();
  // The query behind `useViewerUserId`, for its error state: the helper reports a
  // failed `/v1/users/me` as `null`, the same value it means by "pending", and
  // the read below is gated on that id — so without this the screen shimmers
  // forever on a dead call, with no pull-to-refresh to escape by
  // (`ScreenShell` is a bare ScrollView). The C3 ruling, as dues and tasks
  // already apply it.
  const viewerQuery = useCurrentUser();
  const chapterId = useActiveChapterId();
  const entriesQuery = useServiceEntries(viewerUserId ?? undefined, undefined, {
    enabled: !!viewerUserId,
  });

  const rows = useMemo(
    () => selectServiceEntryRows(entriesQuery.data),
    [entriesQuery.data],
  );
  const summary = useMemo(() => summarizeServiceEntries(rows), [rows]);
  const hasEntries = entriesQuery.isSuccess;

  // Re-read each time the sheet opens: a tab screen is never unmounted, so a
  // clock read once would offer "Today" as the day the screen first mounted.
  const [now, setNow] = useState(() => new Date());
  const openSheet = useCallback(() => {
    setNow(new Date());
    sheetRef.current?.present();
  }, []);

  function renderList() {
    if (viewerQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your account"
          body="Your service hours are filtered to you, so this has to load first."
          onRetry={() => void viewerQuery.refetch()}
          isRetrying={viewerQuery.isFetching}
        />
      );
    }

    // `viewerUserId === null` here is "/v1/users/me has not answered yet" — the
    // error case is already handled above. The entries query is disabled until
    // the id lands, so `isPending` alone would not cover it.
    if (viewerUserId === null || entriesQuery.isPending)
      return <SkeletonLines lines={3} />;
    if (entriesQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your service hours"
          body="If you belong to more than one chapter, pick one from More → Switch chapter first."
          onRetry={() => void entriesQuery.refetch()}
          isRetrying={entriesQuery.isFetching}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          glyph="+"
          title="No service hours yet"
          body="Log a shift and it goes to an officer for approval."
        />
      );
    }
    return (
      <View>
        {rows.map((row, index) => (
          <HistoryRow
            key={row.id}
            title={row.description}
            meta={row.meta}
            isLast={index === rows.length - 1}
            trailing={
              <StatusChip
                label={STATUS_LABELS[row.status]}
                hue={statusHue(row.status, tokens)}
              />
            }
          />
        ))}
      </View>
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_MORE}
      title="Service hours"
      headerAction={
        <HeaderAddButton label="Log service hours" onPress={openSheet} />
      }
    >
      {/* Only stated once the entries are actually in hand. `summary` derives
          from `rows`, which is empty while the query is pending or errored — so
          rendering it unconditionally would headline "0" to a member with
          hours banked. */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryLabelRow}>
          <Text style={styles.summaryLabel}>Approved hours</Text>
          {hasEntries && summary.pendingCount > 0 ? (
            <StatusChip
              label={`${summary.pendingCount} pending`}
              hue={tokens.color.semantic.warning}
            />
          ) : null}
        </View>
        <Text
          style={styles.summaryValue}
          accessibilityLabel={
            hasEntries
              ? `${summary.approvedHours} approved hours`
              : "Approved hours not available yet"
          }
        >
          {hasEntries ? summary.approvedHours : "—"}
        </Text>
      </View>

      <SectionHeader>History</SectionHeader>
      {renderList()}

      <LogHoursSheet
        // A new sheet per chapter: a photo path the sheet holds after a
        // failed create names a path minted under the chapter it was sent from.
        key={chapterId ?? "no-chapter"}
        ref={sheetRef}
        now={now}
      />
    </ScreenShell>
  );
}

const STATUS_LABELS: Record<ServiceEntryStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

function statusHue(status: ServiceEntryStatus, tokens: SignetTokens): string {
  if (status === "APPROVED") return tokens.color.semantic.success;
  if (status === "REJECTED") return tokens.color.semantic.destructive;
  return tokens.color.semantic.warning;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    summaryCard: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
    },
    summaryLabelRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    summaryLabel: {
      flex: 1,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    summaryValue: {
      ...typeRole(tokens.typography.role.display),
      letterSpacing: -0.8,
      color: tokens.color.text.foreground,
      marginTop: tokens.spacing.sm,
    },
  });
}
