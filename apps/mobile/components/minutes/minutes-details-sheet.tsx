import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import {
  useEvent,
  useRoles,
  useUpdateEvent,
  useUpdateMeeting,
  type MeetingMinutes,
} from "@repo/hooks";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import {
  MEETING_OTHER_LABEL_MAX_LENGTH,
  MEETING_TYPES,
  MEETING_TYPE_LABELS,
  MINUTES_READ_COPY,
  STANDARDS_MEETING_NOTE,
  eventOthersInvited,
  type MeetingType,
} from "@repo/validation";
import { WhenRow } from "@/components/events/new-event-sheet";
import { Segmented } from "@/components/segmented";
import {
  SHEET_STACK_BEHAVIOR,
  SheetBackToClose,
  SheetGrabber,
  SheetPrimaryButton,
  SheetScrim,
  TallSheetHeader,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { useChapterBranding } from "@/lib/chapter-branding";
import { BottomSheetScrollView } from "@/lib/sheet-scrollables";
import { typeRole, useFrappTheme } from "@/lib/theme";

const copy = MINUTES_READ_COPY.details;

/** A floor far enough back that any meeting's own day is above it. */
const EARLIEST = new Date(2000, 0, 1);

/**
 * Edit details from the minutes' ⋯ menu (#5562; Paul, 2026-11-19: "a more
 * button in the top right with options like editing the name, the
 * attendees, the type, visibility"). Web's twin is
 * `minutes-details-dialog.tsx`: the same fields in the same order, the same
 * words. The name, the time and who reads belong to the meeting's event, so
 * they save to the event and need `events:update`; the type is the
 * minutes' own.
 */
export const MinutesDetailsSheet = forwardRef<
  BottomSheetModal,
  {
    meeting: MeetingMinutes;
    canEditEvent: boolean;
    /** The minutes' newest version, read fresh, for the type's save. */
    getVersion: () => Promise<string | null>;
    onSaved: () => void;
    /** Who an event invites is changed on the event. */
    onOpenEvent: () => void;
  }
>(function MinutesDetailsSheet(
  { meeting, canEditEvent, getVersion, onSaved, onOpenEvent },
  ref,
) {
  const backgroundStyle = useSheetBackgroundStyle();
  const tall = useTallSheetProps();
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  // A fresh form each time the sheet opens, from what is stored now.
  const [visit, setVisit] = useState(0);
  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      {...tall}
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={() => setVisit((value) => value + 1)}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <TallSheetHeader title={copy.title} onClose={closeSheet} />
        </View>
        <DetailsForm
          key={`${visit}-${meeting.updated_at}`}
          meeting={meeting}
          canEditEvent={canEditEvent && !!meeting.event_id}
          getVersion={getVersion}
          onDone={() => {
            onSaved();
            closeSheet();
          }}
          onOpenEvent={() => {
            closeSheet();
            onOpenEvent();
          }}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function DetailsForm({
  meeting,
  canEditEvent,
  getVersion,
  onDone,
  onOpenEvent,
}: {
  meeting: MeetingMinutes;
  canEditEvent: boolean;
  getVersion: () => Promise<string | null>;
  onDone: () => void;
  onOpenEvent: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentOnPrimary } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const updateEvent = useUpdateEvent();
  const updateMeeting = useUpdateMeeting();
  const event = useEvent(meeting.event_id ?? "");
  const roles = useRoles();
  const startAt = new Date(meeting.event_start_time);
  const endAt = meeting.event_end_time
    ? new Date(meeting.event_end_time)
    : null;
  const [name, setName] = useState(meeting.event_name);
  const [start, setStart] = useState(startAt);
  const [end, setEnd] = useState<Date | null>(endAt);
  const [type, setType] = useState(meeting.meeting_type as MeetingType);
  const [otherLabel, setOtherLabel] = useState(meeting.other_label ?? "");
  const [focused, setFocused] = useState<"name" | "other" | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const now = new Date();

  const nameMissing = canEditEvent && name.trim().length === 0;
  const endBeforeStart =
    canEditEvent && !!end && end.getTime() <= start.getTime();
  const eventChanged =
    canEditEvent &&
    (name.trim() !== meeting.event_name ||
      start.getTime() !== startAt.getTime() ||
      (!!end && end.getTime() !== endAt?.getTime()));
  const typeChanged =
    type !== meeting.meeting_type ||
    (type === "other" && otherLabel.trim() !== (meeting.other_label ?? ""));

  const roleNames = (() => {
    const data = event.data;
    if (!data || eventOthersInvited(data)) return null;
    const byId = new Map(
      toRoleOptions(roles.data).map((role) => [role.id, role.name]),
    );
    const names = [
      ...(data.required_role_ids ?? []),
      ...(data.optional_role_ids ?? []),
    ]
      .map((id) => byId.get(id))
      .filter((value): value is string => !!value);
    return names.length > 0 ? names.join(", ") : null;
  })();

  async function save() {
    setProblem(null);
    if (nameMissing) {
      setProblem(copy.nameRequired);
      return;
    }
    if (endBeforeStart) {
      setProblem(copy.endBeforeStart);
      return;
    }
    if (!eventChanged && !typeChanged) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      if (eventChanged && meeting.event_id) {
        await updateEvent.mutateAsync({
          id: meeting.event_id,
          body: {
            name: name.trim(),
            start_time: start.toISOString(),
            ...(end ? { end_time: end.toISOString() } : {}),
          },
        });
      }
      if (typeChanged) {
        const version = await getVersion();
        if (!version) throw new Error(copy.saveFailed);
        const label = otherLabel.trim();
        await updateMeeting.mutateAsync({
          id: meeting.id,
          body: {
            expected_updated_at: version,
            meeting_type: type,
            other_label: type === "other" && label ? label : null,
          },
        });
      }
      onDone();
    } catch (error) {
      setProblem(errorCopy(error, copy.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Text style={styles.hint}>
        {canEditEvent ? copy.eventNote : copy.eventOnly}
      </Text>
      {canEditEvent ? (
        <>
          <View style={styles.group}>
            <Text style={styles.label}>{copy.name}</Text>
            <BottomSheetTextInput
              value={name}
              onChangeText={setName}
              onFocus={() => setFocused("name")}
              onBlur={() => setFocused(null)}
              accessibilityLabel={copy.name}
              style={[
                styles.field,
                focused === "name" ? styles.fieldFocused : null,
              ]}
            />
          </View>
          <View style={styles.group}>
            <Text style={styles.label}>{copy.when}</Text>
            <WhenRow
              label="Starts"
              value={start}
              now={now}
              minimumDate={EARLIEST}
              disabled={saving}
              onChange={(next) => {
                // The meeting keeps its length when its start moves.
                if (end) {
                  setEnd(
                    new Date(end.getTime() + next.getTime() - start.getTime()),
                  );
                }
                setStart(next);
              }}
            />
            {end ? (
              <WhenRow
                label="Ends"
                value={end}
                now={now}
                minimumDate={EARLIEST}
                disabled={saving}
                onChange={setEnd}
              />
            ) : null}
          </View>
        </>
      ) : null}
      <View style={styles.group}>
        <Text style={styles.label}>{copy.type}</Text>
        <Segmented
          accessibilityLabel={copy.type}
          value={type}
          onChange={setType}
          disabled={saving}
          options={MEETING_TYPES.map((value) => ({
            value,
            label: MEETING_TYPE_LABELS[value],
          }))}
        />
        {type === "other" ? (
          <BottomSheetTextInput
            value={otherLabel}
            onChangeText={setOtherLabel}
            maxLength={MEETING_OTHER_LABEL_MAX_LENGTH}
            onFocus={() => setFocused("other")}
            onBlur={() => setFocused(null)}
            placeholder={copy.otherLabel}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel={copy.otherLabel}
            style={[
              styles.field,
              focused === "other" ? styles.fieldFocused : null,
            ]}
          />
        ) : null}
        <Text style={styles.hint}>{STANDARDS_MEETING_NOTE}</Text>
      </View>
      {meeting.event_id ? (
        <View style={styles.group}>
          <Text style={styles.label}>{copy.whoCanRead}</Text>
          <Text style={styles.value}>
            {roleNames ? copy.someRoles(roleNames) : copy.everyone}
          </Text>
          {canEditEvent ? (
            // Who an event invites has its own controls in the event's
            // editor; one set of them, not a second copy here.
            <Pressable
              accessibilityRole="button"
              onPress={onOpenEvent}
              hitSlop={8}
              style={styles.linkButton}
            >
              <Text style={[styles.link, { color: accent }]}>
                {copy.changeWho}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {problem ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
      <SheetPrimaryButton
        label={copy.save}
        busy={saving}
        disabled={saving}
        onPress={() => void save()}
        accent={accent}
        onAccent={accentOnPrimary}
      />
    </>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    ...sheetFieldStyles(tokens, accent),
    body: {
      gap: tokens.spacing.lg,
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing["2xl"],
    },
    header: {
      backgroundColor: tokens.color.surface.popover,
    },
    group: {
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    value: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    hint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    linkButton: {
      alignSelf: "flex-start",
      minHeight: 32,
      justifyContent: "center",
    },
    link: {
      ...typeRole(tokens.typography.role.label),
    },
    problem: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
