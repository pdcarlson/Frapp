import { Fragment, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  CHAPTER_LOG_ANY,
  CHAPTER_LOG_NO_FILTERS,
  chapterLogFilterRows,
  chapterLogRow,
  groupChapterLogRows,
  useChapterLogs,
  useChapterRoster,
  useMemberDisplayNames,
  type ChapterLogFilterRow,
  type ChapterLogFilters,
  type ChapterLogRow,
} from "@repo/hooks";
import { CHAPTER_LOGS_COPY, CHAPTER_LOGS_TITLE } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_CHAPTER_SETTINGS } from "@/components/back-row";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { Chip, ChipRow, MenuChip } from "@/components/filter-chips";
import { OptionSheet } from "@/components/option-sheet";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Chapter settings → Logs on the phone (Paul, 2026-11-21): the chapter's
 * record of officer changes, newest first under day headings, as web's
 * Settings › Logs draws it. It replaced the `#chapter-audit` channel. Opened
 * from Chapter settings for the viewers the route admits
 * (`chapterSettingsAccess(...).logs`).
 *
 * Filtered with the same three rows as web's Filter menu, in the same order
 * (`chapterLogFilterRows`): Kind, Person, When, each a chip that opens its
 * choices in a sheet, as Documents' Type and Google Drive's chips do.
 */
export default function ChapterLogsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [filters, setFilters] = useState<ChapterLogFilters>(
    CHAPTER_LOG_NO_FILTERS,
  );
  const [openRow, setOpenRow] = useState<ChapterLogFilterRow | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const logs = useChapterLogs(filters);
  const roster = useChapterRoster();
  const { nameFor } = useMemberDisplayNames();

  const filterRows = useMemo(
    () => chapterLogFilterRows(roster.data ?? []),
    [roster.data],
  );
  const groups = useMemo(() => {
    const entries = logs.data?.pages.flat() ?? [];
    return groupChapterLogRows(
      entries.map((entry) => chapterLogRow(entry, nameFor)),
    );
  }, [logs.data, nameFor]);
  const filtered = Object.values(filters).some((v) => v !== CHAPTER_LOG_ANY);

  const chips = (
    <ChipRow scroll>
      {filtered ? (
        <Chip
          accessibilityRole="button"
          accessibilityState={{}}
          accessibilityLabel="Clear filters"
          label="Clear"
          on={false}
          onPress={() => setFilters(CHAPTER_LOG_NO_FILTERS)}
        />
      ) : null}
      {filterRows.map((row) => {
        const value = filters[row.key];
        const picked =
          value === CHAPTER_LOG_ANY
            ? undefined
            : row.options.find((o) => o.value === value)?.label;
        return (
          <MenuChip
            key={row.key}
            name={row.label}
            value={picked}
            hint={`Opens the ${row.label.toLowerCase()} choices.`}
            onPress={() => {
              setOpenRow(row);
              sheetRef.current?.present();
            }}
          />
        );
      })}
    </ChipRow>
  );

  let body: React.ReactNode;
  if (logs.isPending) {
    body = (
      <SkeletonRegion label="Loading the logs">
        <ListSection>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ListRowSkeleton key={i} index={i} description />
          ))}
        </ListSection>
      </SkeletonRegion>
    );
  } else if (logs.isError) {
    body = (
      <ErrorState
        title={CHAPTER_LOGS_COPY.loadError}
        body="Check your connection and try again."
        onRetry={() => void logs.refetch()}
        isRetrying={logs.isRefetching}
      />
    );
  } else if (groups.length === 0) {
    body = (
      <Text style={styles.note}>
        {filtered ? CHAPTER_LOGS_COPY.filteredEmpty : CHAPTER_LOGS_COPY.empty}
      </Text>
    );
  } else {
    body = (
      <>
        {groups.map((group) => (
          <Fragment key={group.day}>
            <SectionHeader>{group.day}</SectionHeader>
            <ListSection>
              {group.rows.map((row) => (
                <LogRow key={row.id} row={row} />
              ))}
            </ListSection>
          </Fragment>
        ))}
        {logs.hasNextPage ? (
          <ListSection>
            <ListRow
              label={CHAPTER_LOGS_COPY.more}
              action
              busy={logs.isFetchingNextPage}
              onPress={() => void logs.fetchNextPage()}
            />
          </ListSection>
        ) : null}
      </>
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_CHAPTER_SETTINGS}
      title={CHAPTER_LOGS_TITLE}
      refresh={() => logs.refetch()}
    >
      <View style={styles.stack}>
        {chips}
        {body}
      </View>
      <OptionSheet
        ref={sheetRef}
        title={openRow?.label ?? ""}
        options={(openRow?.options ?? []).map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        selected={openRow ? filters[openRow.key] : null}
        onSelect={(value) => {
          if (!openRow) return;
          setFilters((current) => ({
            ...current,
            [openRow.key]: value ?? CHAPTER_LOG_ANY,
          }));
        }}
      />
    </ScreenShell>
  );
}

/** One change: who did what to what, the fields under it, the time trailing. */
function LogRow({ row }: { row: ChapterLogRow }) {
  const line = [row.actor, row.phrase, row.subject].filter(Boolean).join(" ");
  return (
    <ListRow
      label={line}
      description={row.changes.length > 0 ? row.changes.join(" · ") : null}
      value={row.time}
    />
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    stack: { gap: tokens.spacing.md },
    note: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
