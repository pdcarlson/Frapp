import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  formatScheduledFor,
  schedulePresets,
  scheduledFailureCopy,
  scheduleTimeProblem,
  useDeleteScheduledMessage,
  useScheduledMessages,
  useSendScheduledMessageNow,
  useUpdateScheduledMessage,
  type ScheduledMessage,
} from "@repo/hooks";
import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { ErrorState } from "@/components/state-block";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  sheetFieldStyles,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { ScheduleWhenField } from "./schedule-send-sheet";

/**
 * The member's scheduled messages in this channel (#4956), opened from the
 * "N scheduled messages" line above the composer: web's Scheduled list
 * (`apps/web/components/chat/schedule-send.tsx`) on the phone, as Slack's
 * Scheduled list works. Only the member sees these. Each row says when it
 * goes, or why it didn't, and offers Edit (text and time, in place), Send now
 * and Delete. A row that didn't send has no Send now: Edit puts it back in
 * line, checked again.
 *
 * The read lives in {@link ScheduledRows}, a child of the modal, so it runs
 * while the sheet is up; the line above the composer reads the same query.
 */
export const SCHEDULED_TITLE = "Scheduled messages";
export const SCHEDULED_EMPTY = "Nothing scheduled here.";
export const SCHEDULED_NOTE =
  "Only you see these. Each posts as you at its time.";

export const ScheduledMessagesSheet = forwardRef<
  BottomSheetModal,
  { channelId: string | null }
>(function ScheduledMessagesSheet({ channelId }, ref) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, useChapterBranding().accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const tallSheet = useTallSheetProps();

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tallSheet}
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        stickyHeaderIndices={[0]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.stickyHeader}>
          <TallSheetHeader title={SCHEDULED_TITLE} onClose={closeSheet} />
        </View>
        <Text style={styles.note}>{SCHEDULED_NOTE}</Text>
        <ScheduledRows channelId={channelId} />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

export function ScheduledRows({ channelId }: { channelId: string | null }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, useChapterBranding().accent);
  const query = useScheduledMessages(channelId);
  const [editing, setEditing] = useState<string | null>(null);

  if (query.isError && query.data === undefined) {
    return (
      <ErrorState
        title="Couldn't load scheduled messages"
        body={describeLoadFailure(query.error)}
        onRetry={() => void query.refetch()}
        isRetrying={query.isFetching}
      />
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return (
      <Text style={styles.empty}>
        {query.isPending ? "Loading…" : SCHEDULED_EMPTY}
      </Text>
    );
  }
  const now = new Date();
  return (
    <View>
      {rows.map((row) =>
        editing === row.id ? (
          <ScheduledEditRow
            key={row.id}
            row={row}
            onDone={() => setEditing(null)}
          />
        ) : (
          <ScheduledRow
            key={row.id}
            row={row}
            now={now}
            onEdit={() => setEditing(row.id)}
          />
        ),
      )}
    </View>
  );
}

function ScheduledRow({
  row,
  now,
  onEdit,
}: {
  row: ScheduledMessage;
  now: Date;
  onEdit: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens, useChapterBranding().accent);
  const sendNow = useSendScheduledMessageNow();
  const remove = useDeleteScheduledMessage();
  const [error, setError] = useState<string | null>(null);
  const busy = sendNow.isPending || remove.isPending;
  const failed = row.status === "failed";
  const when = failed
    ? scheduledFailureCopy(row.failure_reason)
    : formatScheduledFor(new Date(row.send_at), now);

  return (
    <View style={styles.row} testID={`scheduled-row-${row.status}`}>
      <Text style={failed ? styles.metaFailed : styles.meta}>{when}</Text>
      <Text style={styles.content} numberOfLines={4}>
        {row.content}
      </Text>
      <View style={styles.actions}>
        <RowAction label="Edit" onPress={onEdit} disabled={busy} />
        {failed ? null : (
          <RowAction
            label="Send now"
            disabled={busy}
            onPress={() => {
              setError(null);
              sendNow.mutate(row.id, {
                onError: (cause) => setError(errorCopy(cause)),
              });
            }}
          />
        )}
        <RowAction
          label="Delete"
          disabled={busy}
          onPress={() => {
            setError(null);
            remove.mutate(row.id, {
              onError: (cause) => setError(errorCopy(cause)),
            });
          }}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.metaFailed}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function ScheduledEditRow({
  row,
  onDone,
}: {
  row: ScheduledMessage;
  onDone: () => void;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  const update = useUpdateScheduledMessage();
  // A failed message's time has passed: offer the next preset instead.
  const [at, setAt] = useState(() =>
    row.status === "failed"
      ? schedulePresets(new Date())[0].at
      : new Date(row.send_at),
  );
  const [content, setContent] = useState(row.content);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = scheduleTimeProblem(at, new Date());
  const empty = content.trim() === "";
  const blocked = update.isPending;

  return (
    <View style={styles.row}>
      <BottomSheetTextInput
        accessibilityLabel="Message"
        multiline
        value={content}
        onChangeText={setContent}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!blocked}
        style={[
          styles.field,
          styles.fieldMultilineText,
          focused ? styles.fieldFocused : null,
        ]}
      />
      <ScheduleWhenField
        value={at}
        onChange={setAt}
        disabled={blocked}
        brand={brand}
      />
      {problem || error ? (
        <Text accessibilityLiveRegion="polite" style={styles.metaFailed}>
          {problem ?? error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <RowAction label="Cancel" onPress={onDone} disabled={blocked} />
        <RowAction
          label="Save"
          accent
          disabled={blocked || problem !== null || empty}
          onPress={() => {
            setError(null);
            update.mutate(
              {
                id: row.id,
                ...(content !== row.content ? { content } : {}),
                sendAt: at,
              },
              {
                onSuccess: onDone,
                onError: (cause) => setError(errorCopy(cause)),
              },
            );
          }}
        />
      </View>
    </View>
  );
}

function RowAction({
  label,
  onPress,
  disabled,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  accent?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens, brand.accent);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled ? styles.actionDisabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        style={[styles.actionText, accent ? { color: brand.accent } : null]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fields = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    scroll: {
      flex: 1,
    },
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    stickyHeader: {
      backgroundColor: tokens.color.surface.popover,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingBottom: tokens.spacing.sm,
    },
    row: {
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.color.border.hairline,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    metaFailed: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
    content: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    actions: {
      flexDirection: "row",
      gap: tokens.spacing.lg,
    },
    action: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
    },
    actionDisabled: {
      opacity: 0.4,
    },
    actionText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: { ...fields.field, minHeight: tokens.touch.minimum * 2 },
    fieldMultilineText: fields.fieldMultilineText,
    fieldFocused: fields.fieldFocused,
    empty: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      paddingVertical: tokens.spacing.xl,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
