import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useComingUpPostReview,
  useMemberDisplayNames,
  useTrackComingUpDates,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  COMING_UP_REVIEW_COPY,
  type ComingUpReviewRow,
  type MeetingContent,
} from "@repo/validation";
import { CheckGlyph } from "@/components/control-glyphs";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { selectionHaptic, successHaptic } from "@/lib/haptics";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The review that follows Post (#5672 step 3; Paul picked "Review at Post",
 * 2026-11-19), web's `coming-up-post-review.tsx` as a sheet, with the same
 * lines in the same order and words: once minutes are posted, what each
 * Coming up date still needs, a task for the member the minutes say owns it
 * or for the poster, every one ticked for them to untick, and the dates
 * already on the calendar. Skip and Track sit in the sheet's header, as the phone's other
 * short sheets put their actions. The minutes post first, with no question
 * (Paul, 2026-11-16), so a review closed or failed never holds them back.
 * The host mounts it once the minutes post.
 */
export function ComingUpPostReview({
  meetingId,
  content,
  viewerId,
  onDone,
  onTracked,
}: {
  meetingId: string;
  content: Pick<MeetingContent, "dates" | "action_items">;
  viewerId: string | null;
  /** The review closed, or had nothing to offer. The host unmounts it. */
  onDone: () => void;
  /** The line to show and announce once the tasks are made. */
  onTracked: (line: string) => void;
}) {
  const offered = useComingUpPostReview(meetingId, content, true);
  // The lines as they first read: making a task changes what tracks a date,
  // and the list must not move under the poster's hand.
  const [rows, setRows] = useState<ComingUpReviewRow[] | null>(null);
  const needed = !!viewerId && !!offered?.some((row) => row.kind === "task");
  if (rows === null && offered && needed) setRows(offered);
  // Nothing to review: no date needs a task, or the poster can't make one.
  // Judged once, before the lines freeze: the tasks Track makes refetch what
  // `offered` reads, and must not close the review under the poster.
  useEffect(() => {
    if (rows === null && offered && !needed) onDone();
  }, [rows, offered, needed, onDone]);

  if (!rows || !viewerId) return null;
  return (
    <ReviewSheet
      rows={rows}
      viewerId={viewerId}
      onClosed={onDone}
      onTracked={onTracked}
    />
  );
}

function ReviewSheet({
  rows,
  viewerId,
  onClosed,
  onTracked,
}: {
  rows: ComingUpReviewRow[];
  viewerId: string;
  onClosed: () => void;
  onTracked: (line: string) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const ref = useRef<BottomSheetModal>(null);
  const { onAnimate, markClosed, dismiss } = useSheetVisit(ref);
  const names = useMemberDisplayNames();
  const track = useTrackComingUpDates();
  const [ticked, setTicked] = useState(
    () => new Set(rows.filter((row) => row.checked).map((row) => row.index)),
  );
  const chosen = rows.filter(
    (row) => row.kind === "task" && ticked.has(row.index),
  );

  useEffect(() => {
    ref.current?.present();
  }, []);

  async function save() {
    if (track.isPending || chosen.length === 0) return;
    const { made, failed } = await track.mutateAsync({
      rows: chosen,
      viewerId,
    });
    if (made > 0) successHaptic();
    onTracked(
      [
        made > 0 ? COMING_UP_REVIEW_COPY.made(made) : null,
        failed > 0
          ? `${COMING_UP_REVIEW_COPY.failed(failed)}. ${COMING_UP_REVIEW_COPY.failedDetail}`
          : null,
      ]
        .filter(Boolean)
        .join(". "),
    );
    dismiss();
  }

  function whose(row: ComingUpReviewRow): string | null {
    if (!row.assigneeId || row.assigneeId === viewerId) return null;
    return names.nameFor(row.assigneeId) ?? null;
  }

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={() => {
        markClosed();
        onClosed();
      }}
    >
      <SheetBackToClose onClose={dismiss} />
      <BottomSheetScrollView
        onAccessibilityEscape={dismiss}
        contentContainerStyle={styles.body}
      >
        <SheetHeader
          title={COMING_UP_REVIEW_COPY.title}
          cancelLabel={COMING_UP_REVIEW_COPY.skip}
          onCancel={dismiss}
          cancelDisabled={track.isPending}
          action={{
            label: COMING_UP_REVIEW_COPY.track(chosen.length),
            onPress: () => void save(),
            disabled: track.isPending || chosen.length === 0,
            accent,
            onAccent: accentOnPrimary,
          }}
        />
        <Text style={styles.hint}>{COMING_UP_REVIEW_COPY.description}</Text>
        <View>
          {rows.map((row) =>
            row.kind === "task" ? (
              <CheckRow
                key={row.index}
                label={COMING_UP_REVIEW_COPY.taskFor(whose(row))}
                detail={COMING_UP_REVIEW_COPY.due(row.title, row.date)}
                checked={ticked.has(row.index)}
                disabled={track.isPending}
                onPress={() => {
                  selectionHaptic();
                  setTicked((current) => {
                    const next = new Set(current);
                    if (next.has(row.index)) next.delete(row.index);
                    else next.add(row.index);
                    return next;
                  });
                }}
              />
            ) : (
              <View
                key={row.index}
                accessible
                style={[styles.row, styles.calendarRow]}
              >
                <View style={styles.text}>
                  <Text style={[styles.label, styles.muted]}>
                    {COMING_UP_REVIEW_COPY.onCalendar}
                  </Text>
                  <Text style={styles.hint}>
                    {COMING_UP_REVIEW_COPY.onCalendarDetail(
                      row.title,
                      row.date,
                    )}
                  </Text>
                </View>
              </View>
            ),
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function CheckRow({
  label,
  detail,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.box,
          checked && { backgroundColor: accent, borderColor: accent },
        ]}
      >
        {checked ? (
          <CheckGlyph color={tokens.color.surface.background} size={12} />
        ) : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
    },
    // Lines up under a task line's words, past where its box would be.
    calendarRow: {
      paddingLeft: 20 + tokens.spacing.md,
    },
    text: {
      flex: 1,
      gap: 2,
    },
    label: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      fontWeight: "500",
    },
    muted: {
      color: tokens.color.text.mutedForeground,
    },
    box: {
      width: 20,
      height: 20,
      marginTop: 2,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: tokens.color.border.control,
    },
    pressed: {
      opacity: 0.6,
    },
  });
}
