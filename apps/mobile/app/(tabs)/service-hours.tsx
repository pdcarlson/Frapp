import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useCreateServiceEntry, useServiceEntries } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  EmptyState,
  ErrorState,
  SkeletonLines,
} from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  formatDuration,
  parseDurationInput,
  selectServiceEntryRows,
  summarizeServiceEntries,
  todayIsoDate,
} from "@/lib/more/service-hours";
import { useConnection } from "@/lib/connection/use-connection";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Service hours, hosting the s20 "Log service hours" sheet
 * (`canvas-screens.dc.html:648`).
 *
 * The list is the member's own history: `GET /v1/service-entries` pins a
 * non-admin's read to their own id server-side, so no client-side filter makes
 * that true and none pretends to.
 *
 * ## No proof attachment
 *
 * Canvas draws a proof upload in the sheet, and the API supports it
 * (`proof_path` plus a signed-upload endpoint). Attaching one needs an image or
 * file picker, and none is a dependency of this app — `package.json` is frozen
 * under #937's hotspot protocol. The field is omitted rather than rendered
 * dead; entries submitted here are reviewed on their description. Filed.
 *
 * ## Sheet mechanics
 *
 * `@gorhom/bottom-sheet` v5 with `BottomSheetTextInput` and
 * `keyboardBehavior="interactive"`, both required by
 * `spec/ui/mobile/patterns.md` — a plain `TextInput` breaks the sheet's
 * keyboard coordination. The submit CTA is 50px as drawn, which wins over
 * `components.md`'s 48px under the reference-first precedence rule.
 */
export default function ServiceHoursScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const sheetRef = useRef<BottomSheetModal>(null);

  const entriesQuery = useServiceEntries();
  const createEntry = useCreateServiceEntry();

  const rows = useMemo(
    () => selectServiceEntryRows(entriesQuery.data),
    [entriesQuery.data],
  );
  const summary = useMemo(() => summarizeServiceEntries(rows), [rows]);
  const hasEntries = entriesQuery.isSuccess;

  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("");
  const [submitFailed, setSubmitFailed] = useState(false);

  /**
   * s20 has **no outbox**. A submit posted with no network is simply lost, so
   * this is one of the surfaces `spec/ui/resilience.md` § 2 means when it says
   * write actions are "Disabled with tooltip: 'Reconnect to make changes'"
   * (#501). The chat composer deliberately does the opposite, because it has a
   * queue — `lib/connection/state.ts` holds the split.
   */
  const { writeBlockedReason } = useConnection();

  const durationMinutes = parseDurationInput(duration);
  const canSubmit =
    description.trim().length > 0 &&
    durationMinutes !== null &&
    writeBlockedReason === null &&
    !createEntry.isPending;

  const openSheet = useCallback(() => {
    setSubmitFailed(false);
    sheetRef.current?.present();
  }, []);

  const closeSheet = useCallback(() => {
    sheetRef.current?.dismiss();
  }, []);

  function submit() {
    if (!canSubmit || durationMinutes === null) return;
    createEntry.mutate(
      {
        date: todayIsoDate(new Date()),
        duration_minutes: durationMinutes,
        description: description.trim(),
      },
      {
        onSuccess: () => {
          setDescription("");
          setDuration("");
          setSubmitFailed(false);
          closeSheet();
        },
        onError: () => setSubmitFailed(true),
      },
    );
  }

  function renderList() {
    if (entriesQuery.isPending) return <SkeletonLines lines={3} />;
    if (entriesQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your service hours"
          body="If you belong to more than one chapter, pick one from More → Chapter first."
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
      <ListSection>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            label={row.description}
            description={row.meta}
            trailing={
              <Text style={statusStyle(row.status, styles)}>
                {STATUS_LABELS[row.status]}
              </Text>
            }
          />
        ))}
      </ListSection>
    );
  }

  return (
    <ScreenShell
      title="Service hours"
      subtitle="Philanthropy work you've logged, and where it stands."
      headerAction={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log service hours"
          hitSlop={tokens.spacing.sm}
          onPress={openSheet}
        >
          <Text style={styles.headerAction}>Log</Text>
        </Pressable>
      }
    >
      {/* Only stated once the entries are actually in hand. `summary` derives
          from `rows`, which is empty while the query is pending or errored — so
          rendering it unconditionally would headline "0 hrs / nothing pending"
          to a member with hours banked. */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Approved</Text>
        <Text style={styles.summaryValue}>
          {hasEntries ? `${summary.approvedHours} hrs` : "—"}
        </Text>
        <Text style={styles.summaryMeta}>
          {!hasEntries
            ? "Waiting on your service history."
            : summary.pendingCount === 0
              ? "Nothing waiting on review."
              : `${summary.pendingCount} ${
                  summary.pendingCount === 1 ? "entry" : "entries"
                } awaiting review.`}
        </Text>
      </View>

      <SectionHeader>History</SectionHeader>
      {renderList()}

      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={styles.sheetBackground}
        handleComponent={() => (
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
        )}
      >
        <BottomSheetView style={styles.sheetBody}>
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>Log service hours</Text>
            {/* hitSlop meets the ≥44px floor while keeping §9's compact visual
                (the #939 ruling pattern). */}
            <Pressable
              accessibilityRole="button"
              onPress={closeSheet}
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
            >
              <Text style={styles.sheetCancel}>Cancel</Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>What did you do?</Text>
          <BottomSheetTextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Food bank volunteer shift"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Service description"
            style={styles.sheetInput}
          />

          <Text style={styles.fieldLabel}>How long?</Text>
          <BottomSheetTextInput
            value={duration}
            onChangeText={setDuration}
            placeholder="2:30 or 2.5"
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Duration in hours"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            style={styles.sheetInput}
          />
          <Text style={styles.fieldHint}>
            {duration.trim().length === 0
              ? "Hours and minutes, or a decimal. Dated today."
              : durationMinutes === null
                ? "Enter a duration like 2:30 or 2.5, up to 24 hours."
                : // Echoed back because a bare number reads as hours: "45"
                  // means 45 hours, and the history has no way to correct it.
                  `Logging ${formatDuration(durationMinutes)}, dated today.`}
          </Text>

          {submitFailed ? (
            <Text style={styles.sheetError}>
              That didn&apos;t save. Your entry is still here — try again.
            </Text>
          ) : null}

          {writeBlockedReason ? (
            <Text style={styles.sheetError}>{writeBlockedReason}</Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            // Wired to the control, not merely printed above it: a screen
            // reader lands on the disabled button, not on the sentence before.
            accessibilityHint={writeBlockedReason ?? undefined}
            disabled={!canSubmit}
            onPress={submit}
            style={[
              styles.sheetPrimaryButton,
              canSubmit ? null : styles.sheetPrimaryButtonDisabled,
            ]}
          >
            <Text style={styles.sheetPrimaryButtonText}>
              {createEntry.isPending ? "Submitting…" : "Submit for approval"}
            </Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheetModal>
    </ScreenShell>
  );
}

const STATUS_LABELS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

function statusStyle(
  status: keyof typeof STATUS_LABELS,
  styles: ReturnType<typeof createStyles>,
) {
  if (status === "APPROVED") return styles.statusApproved;
  if (status === "REJECTED") return styles.statusRejected;
  return styles.statusPending;
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    headerAction: {
      ...typeRole(tokens.typography.role.label),
      color: accent,
    },
    summaryCard: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    summaryLabel: {
      ...typeRole(tokens.typography.role.caption),
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: tokens.color.text.muted,
    },
    summaryValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      letterSpacing: -0.3,
    },
    summaryMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    statusPending: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.warning,
    },
    statusApproved: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.success,
    },
    statusRejected: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    sheetBackground: {
      backgroundColor: tokens.color.surface.popover,
      borderTopLeftRadius: tokens.radius.sheet,
      borderTopRightRadius: tokens.radius.sheet,
    },
    grabberZone: {
      paddingTop: tokens.spacing.sm,
      paddingBottom: tokens.spacing.md,
      alignItems: "center",
    },
    grabber: {
      width: 40,
      height: 4.5,
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.text.foreground, 0.18),
    },
    sheetBody: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    sheetHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: tokens.spacing.sm,
    },
    sheetTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    sheetCancel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.muted,
    },
    fieldLabel: {
      ...typeRole(tokens.typography.role.caption),
      textTransform: "uppercase",
      letterSpacing: 0.3,
      color: tokens.color.text.mutedForeground,
    },
    sheetInput: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    sheetError: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    sheetPrimaryButton: {
      marginTop: tokens.spacing.sm,
      // 50px as drawn (canvas-screens.dc.html:663); the reference wins over
      // components.md §9's 48px per spec/ui/README.md's precedence rule.
      height: 50,
      borderRadius: tokens.radius.control,
      backgroundColor: accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sheetPrimaryButtonDisabled: {
      opacity: 0.5,
    },
    sheetPrimaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
  });
}
