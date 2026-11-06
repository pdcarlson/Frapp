import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import {
  memberFallbackLabel,
  useChapterRoster,
  useCreateTask,
  useViewerUserId,
} from "@repo/hooks";
import { avatarRadius, typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding, type ChapterBranding } from "@/lib/chapter-branding";
import { initialsFor } from "@/lib/more/narrow";
import { FilterChips } from "@/components/filter-chips";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  TallSheetHeader,
  useSheetBackgroundStyle,
  useSheetVisit,
  useTallSheetProps,
} from "@/components/sheet-scaffold";
import { CalendarGlyph } from "@/components/tasks/task-glyphs";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";
import {
  DEFAULT_DUE_CHOICE,
  dueChoiceOf,
  duePresets,
  formatDueFieldLabel,
  parsePointReward,
  resolveDue,
  validateNewTask,
  type DueChoice,
} from "@/lib/tasks/create-task";
import { successHaptic } from "@/lib/haptics";
import { MODULE_REFUSAL_COPY, moduleRefusalOf } from "@/lib/module-refusal";
import {
  SUBSCRIPTION_REFUSAL_COPY,
  subscriptionRefusalOf,
} from "@/lib/subscription-refusal";

/**
 * s19 — the "New task" bottom sheet (`canvas-screens.dc.html`, `id="s19"`).
 *
 * Creation is a bottom sheet by rule, not by preference:
 * `spec/ui/mobile/README.md` § Native-feel rules binds "new task" to
 * `@gorhom/bottom-sheet` v5. `BottomSheetTextInput` throughout, because a
 * plain `TextInput` breaks the sheet's keyboard coordination. s20's log sheet
 * (`components/service-hours/log-hours-sheet.tsx`) is built on the same chrome.
 *
 * ## Two deviations from the drawing, both forced
 *
 * **The date is presets, not a free field.** No date-picker dependency exists
 * and `package.json` is frozen under #937's hotspot protocol — see the header of
 * `lib/tasks/create-task.ts` for the full reasoning.
 *
 * **The focus ring is a border, not a shadow.** Canvas draws
 * `box-shadow: 0 0 0 3px rgba(239,182,59,.22)`. React Native has no
 * `box-shadow`, and drop shadows are banned outright by the De-Google
 * guardrails. Rendered instead as a wrapping view carrying `focus.ringWidth` /
 * `focus.ringOpacity`, from `sheetFieldStyles` so s20 draws the same ring.
 *
 * ## The draft outlives a close, not a Cancel
 *
 * The sheets' keep-the-draft rule (`spec/ui/mobile/patterns.md` § Bottom
 * sheets, "A draft outlives a close"): a swipe or scrim close keeps the draft
 * for the next visit, Cancel or a successful create gives it up, and Cancel
 * is held while a create runs. What is particular to s19 is its due chip and
 * its chapter, below.
 *
 * A kept draft reads its due chip against the day it is filed (`at` moves
 * with the host's clock, which re-reads on tab focus and on a return to the
 * app). "Today" and "Tomorrow" are relative, so a draft kept overnight with
 * "Today" files the new day, as s20's "Today" and "Yesterday" do. "Friday" and
 * "Next week" name a date, and the draft holds the date they named when
 * picked: the chip shown selected is whichever resolves to that date today (on
 * Thursday a kept Friday is the Tomorrow chip), and a held date that has
 * passed falls back to Today (`resolveDue`).
 *
 * The host mounts a new sheet per chapter, so a kept draft never crosses into
 * another chapter: its assignee is a member of the chapter it was started in,
 * and the API refuses one who isn't.
 *
 * ## A create can outlive its visit
 *
 * The close after a create goes through `useSheetVisit`: a member who swipes
 * the sheet away mid-create would otherwise have `dismiss()` called on a
 * closed modal, which leaves the next `present()` drawing nothing (#3405), and
 * a sheet reopened since would be closed under them.
 *
 * The draft is read-only while the create runs, and Cancel is held: the
 * create can't be called back, so a Cancel then would clear a draft that gets
 * filed anyway. A swipe still closes the sheet and keeps it. That lock covers
 * a visit reopened mid-create too: this component stays mounted on the host
 * across a close (gorhom unmounts only the modal's content), so the reopened
 * sheet reads the same pending create and the same draft. A create that lands
 * clears the draft whichever visit is on screen, since it is still the one
 * that was sent.
 */

export interface NewTaskSheetProps {
  /** Injected so the presets are deterministic under test. */
  now?: Date;
  /** Fired after a successful create, with the assignee's name for the confirmation. */
  onCreated?: (assigneeName: string | null, wasSelf: boolean) => void;
}

interface RosterMember {
  userId: string;
  name: string | null;
}

/**
 * The roster, read off the generated types rather than hand-narrowed.
 *
 * `GET /v1/members/roster` is one of the few reads that **does** declare a
 * response schema, so the SDK gives its rows a real type — which is why
 * `useMemberDisplayNames` says "No `unknown`-parsing here". Narrowing it by
 * string key anyway would turn a future `display_name` rename from a compile
 * error into a picker that silently renders every brother as "Member".
 *
 * `display_name` is `NOT NULL DEFAULT ''`, so empty is normalized to `null` —
 * absent and empty are the same "no name set" case, as `narrow.ts` documents.
 */
function selectRoster(
  data: readonly { user_id: string; display_name: string }[] | undefined,
): RosterMember[] {
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    name: row.display_name.trim().length > 0 ? row.display_name : null,
  }));
}

export const NewTaskSheet = forwardRef<BottomSheetModal, NewTaskSheetProps>(
  function NewTaskSheet({ now, onCreated }, ref) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const { accent } = brand;
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const pickerSheet = useTallSheetProps();
    const pickerRef = useRef<BottomSheetModal>(null);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    const viewerUserId = useViewerUserId();
    const rosterQuery = useChapterRoster();
    const createTask = useCreateTask();

    // Read when the host's clock moves rather than per render, so the presets
    // cannot shift under the member mid-edit.
    const at = useMemo(() => now ?? new Date(), [now]);
    const presets = useMemo(() => duePresets(at), [at]);

    const [title, setTitle] = useState("");
    const [pointsInput, setPointsInput] = useState("");
    // The chip as the draft holds it, resolved against today's below.
    const [due, setDue] = useState<DueChoice>(DEFAULT_DUE_CHOICE);
    // Defaults to the viewer, so the common case needs no picker interaction.
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    const [titleFocused, setTitleFocused] = useState(false);
    const [search, setSearch] = useState("");
    const [submitFailed, setSubmitFailed] = useState(false);
    /**
     * The member copy for a gate refusal, or `null`. A refusal is a different
     * outcome from a failed save, not a worse one (#2297). Two gates refuse
     * `POST /v1/tasks` permanently until an officer acts: the subscription
     * gate while the chapter is not active, and the module gate while `tasks`
     * is switched off (`@RequireModule('tasks')`, #2718). Either way this sheet
     * stops offering "try again" and stops offering the Create button at all,
     * because retrying is the one thing that cannot work. The copy is the
     * latch, so the two can't disagree. `submitFailed` keeps its exact old
     * meaning: a save that might succeed.
     */
    const [refusal, setRefusal] = useState<string | null>(null);
    // Set the moment Create sends, before `isPending` reaches a render: two
    // taps handled in one batch both see the same render's `canSubmit`, as on
    // s20's log sheet.
    const sending = useRef(false);

    const roster = useMemo(
      () => selectRoster(rosterQuery.data),
      [rosterQuery.data],
    );

    const effectiveAssigneeId = assigneeId ?? viewerUserId;
    const assignee = roster.find((row) => row.userId === effectiveAssigneeId);
    const assigneeName = assignee?.name ?? null;
    const assigneeIsViewer =
      effectiveAssigneeId !== null && effectiveAssigneeId === viewerUserId;
    /**
     * What the collapsed row says.
     *
     * "You" is keyed on the *id*, never on a missing name: `display_name` is
     * `NOT NULL DEFAULT ''` and normalizes to `null`, so falling back to "You"
     * for an unnamed member would tell an officer they were assigning a pledge's
     * task to themselves — and the post-create confirmation, which compares ids,
     * would then contradict the field.
     */
    const assigneeLabel = assigneeIsViewer
      ? (assigneeName ?? "You")
      : (assigneeName ??
        (effectiveAssigneeId
          ? memberFallbackLabel(effectiveAssigneeId)
          : "Member"));

    // See the header: a relative chip re-reads today, a held date stays put.
    const { date: dueDate, chipId: dueChipId } = resolveDue(due, at);
    const pending = createTask.isPending;

    const draft = {
      title,
      dueDate,
      assigneeId: effectiveAssigneeId,
      pointsInput,
    };
    const body = validateNewTask(draft);
    const pointsInvalid = parsePointReward(pointsInput).kind === "invalid";
    const canSubmit = body !== null && !pending && refusal === null;

    /** The draft itself: what a create sends. */
    const clearDraft = useCallback(() => {
      setTitle("");
      setPointsInput("");
      setDue(DEFAULT_DUE_CHOICE);
      setAssigneeId(null);
    }, []);

    /** Gives the draft up, and the visit's state with it: Cancel. */
    const reset = useCallback(() => {
      clearDraft();
      setSearch("");
      setSubmitFailed(false);
      setRefusal(null);
      setTitleFocused(false);
    }, [clearDraft]);

    /**
     * A swipe or scrim close: only what belongs to the visit goes. The draft
     * stays for the next one, and so does nothing that would contradict it:
     * the error latches clear because reopening is the member's deliberate
     * second try (an officer may have sorted the gate out since).
     */
    const closed = useCallback(() => {
      markClosed();
      setTitleFocused(false);
      setSearch("");
      setSubmitFailed(false);
      setRefusal(null);
    }, [markClosed]);

    // Held while a create runs (`cancelDisabled` below; the header says
    // why). `sending` covers a tap in the same batch as Create, before
    // `isPending` reaches a render.
    const cancel = useCallback(() => {
      if (sending.current) return;
      reset();
      dismiss();
    }, [reset, dismiss]);

    const submit = useCallback(() => {
      // `canSubmit`, not just `body`, as in s20's log sheet: otherwise only the
      // button's `disabled` stands between a refused sheet and another POST.
      // It also stops a create in flight, but only once `isPending` has
      // reached a render; `sending` stops a second tap in the same batch.
      if (!body || !canSubmit || sending.current) return;
      sending.current = true;
      setSubmitFailed(false);
      setRefusal(null);
      const sentFrom = visit();
      createTask.mutate(body, {
        onSuccess: () => {
          sending.current = false;
          const wasSelf = body.assignee_id === viewerUserId;
          // The confirming action (`spec/ui/mobile/README.md` § Native-feel
          // rules), felt once the task exists.
          successHaptic();
          // The draft was saved, so it goes whichever visit is on screen:
          // keeping it would invite a duplicate. A visit reopened since is
          // read-only until now (see the header), so it still holds what
          // was sent.
          clearDraft();
          // A sheet closed and reopened since is the member's new visit, and
          // the create doesn't close it under them.
          if (isSameVisit(sentFrom)) dismiss();
          onCreated?.(assigneeName, wasSelf);
        },
        onError: (error) => {
          sending.current = false;
          // A visit that has ended doesn't latch its outcome into the next
          // one, which would greet the member with a stale error.
          if (!isSameVisit(sentFrom)) return;
          // Ordinary failures keep the retry they have always had; only a gate
          // refusal takes it away, because only it cannot win. Never a bare
          // 403: this route also 403s for permission denials.
          if (subscriptionRefusalOf(error)) {
            setRefusal(SUBSCRIPTION_REFUSAL_COPY.task);
            return;
          }
          if (moduleRefusalOf(error)) {
            setRefusal(MODULE_REFUSAL_COPY.task);
            return;
          }
          setSubmitFailed(true);
        },
      });
    }, [
      body,
      canSubmit,
      createTask,
      viewerUserId,
      clearDraft,
      dismiss,
      visit,
      isSameVisit,
      onCreated,
      assigneeName,
    ]);

    const filteredRoster = useMemo(() => {
      const needle = search.trim().toLowerCase();
      if (needle.length === 0) return roster;
      return roster.filter((row) =>
        (row.name ?? "").toLowerCase().includes(needle),
      );
    }, [roster, search]);

    return (
      <>
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
        onAnimate={onAnimate}
        onDismiss={closed}
      >
        <BottomSheetView style={styles.body}>
          <SheetHeader
            title="New task"
            onCancel={cancel}
            cancelDisabled={pending}
          />

          {/* The focus ring is the wrapper, not the field — see the header. It
              tracks real focus rather than "has text", which would leave the
              ring lit on a filled field nobody is editing. */}
          <View style={[styles.ring, titleFocused ? styles.ringActive : null]}>
            <BottomSheetTextInput
              value={title}
              onChangeText={setTitle}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => setTitleFocused(false)}
              // Read-only while the create runs: it sent what was typed when
              // Create was pressed, and its success clears that.
              editable={!pending}
              placeholder="Collect ride-share forms"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Task title"
              maxLength={TITLE_MAX_LENGTH}
              style={[
                styles.field,
                titleFocused ? styles.fieldFocused : null,
              ]}
            />
          </View>

          <View style={styles.splitRow}>
            <View style={[styles.field, styles.splitField]}>
              <CalendarGlyph color={tokens.color.text.mutedForeground} />
              <Text style={styles.fieldValue}>
                {formatDueFieldLabel(dueDate)}
              </Text>
            </View>

            <View style={[styles.field, styles.splitField]}>
              <Text style={[styles.pointsSign, { color: accent }]}>+</Text>
              <BottomSheetTextInput
                value={pointsInput}
                onChangeText={setPointsInput}
                editable={!pending}
                placeholder="pts"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Point reward"
                keyboardType="number-pad"
                style={styles.pointsInput}
              />
            </View>
          </View>

          <FilterChips
            chips={presets.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
            selected={dueChipId}
            onSelect={(value) => {
              const preset = presets.find((each) => each.id === value);
              if (preset && !pending) setDue(dueChoiceOf(preset));
            }}
            accessibilityLabel="Due date"
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Assignee: ${assigneeLabel}`}
            accessibilityHint="Choose who this task is for."
            accessibilityState={{ disabled: pending }}
            disabled={pending}
            onPress={() => {
              setSearch("");
              pickerRef.current?.present();
            }}
            style={styles.assigneeRow}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initialsFor(assigneeName)}</Text>
            </View>
            <Text style={styles.fieldValue} numberOfLines={1}>
              {assigneeLabel}
            </Text>
            <Text style={styles.assigneeHint}>assignee</Text>
          </Pressable>

          {pointsInvalid ? (
            <Text style={styles.error}>
              Points must be a whole number, up to 100,000.
            </Text>
          ) : null}

          {refusal ? <Text style={styles.error}>{refusal}</Text> : null}

          {submitFailed ? (
            <Text style={styles.error}>
              That didn&apos;t save. Your task is still here — try again.
            </Text>
          ) : null}

          <SheetPrimaryButton
            label={createTask.isPending ? "Creating…" : "Create task"}
            onPress={submit}
            disabled={!canSubmit}
            accessibilityHint={refusal ?? undefined}
            accent={accent}
            onAccent={tokens.color.gold.onHouse}
          />
        </BottomSheetView>
      </BottomSheetModal>

      {/* A second, stacked sheet rather than an inline list.
          `BottomSheetFlatList` must be a **direct** child of the sheet: nested
          inside a `BottomSheetView` under `enableDynamicSizing`, the view writes
          its frame height and the scrollable writes its content height to the
          same animated `contentHeight`, so a 60-member roster snaps the sheet to
          full screen and then jumps back on the next layout pass. Fixed
          snap points here for the same reason — a list has no natural height to
          size to. Snap points alone don't turn dynamic sizing off in v5: it
          defaults on and adds a content-height detent below 100%, so a short or
          filtered roster would open the picker short and shrink it per
          keystroke. */}
      <BottomSheetModal
        ref={pickerRef}
        // A tall sheet (`components.md` § Surface size): the whole roster,
        // and a search the keyboard would otherwise squeeze into a sliver of
        // the old 70% box.
        {...pickerSheet}
        keyboardBehavior="interactive"
        backgroundStyle={backgroundStyle}
        handleComponent={SheetGrabber}
        backdropComponent={SheetScrim}
      >
        <BottomSheetFlatList
          data={filteredRoster}
          keyExtractor={(row: RosterMember) => row.userId}
          contentContainerStyle={styles.pickerContent}
          keyboardShouldPersistTaps="handled"
          // The title and search stay pinned while the roster scrolls under
          // them, so the field is still there after a long scroll.
          stickyHeaderIndices={[0]}
          ListHeaderComponent={
            <View style={styles.pickerHeader}>
              <TallSheetHeader
                title="Assign to"
                onClose={() => pickerRef.current?.dismiss()}
              />
              {/* Not `SearchField` from `components/filter-chips.tsx`: that is a
                  plain `TextInput`, and inside a gorhom sheet a plain input
                  breaks the sheet's keyboard coordination — `patterns.md` makes
                  `BottomSheetTextInput` mandatory here. */}
              <BottomSheetTextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search members"
                placeholderTextColor={tokens.color.text.muted}
                accessibilityLabel="Search members"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.field}
              />
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.pickerEmpty}>
              {rosterQuery.isPending
                ? "Loading your chapter…"
                : "No members match that search."}
            </Text>
          }
          renderItem={({ item }: { item: RosterMember }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                selected: item.userId === effectiveAssigneeId,
              }}
              onPress={() => {
                setAssigneeId(item.userId);
                setSearch("");
                pickerRef.current?.dismiss();
              }}
              style={styles.pickerRow}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsFor(item.name)}</Text>
              </View>
              <Text style={styles.fieldValue} numberOfLines={1}>
                {item.name ?? memberFallbackLabel(item.userId)}
              </Text>
            </Pressable>
          )}
        />
      </BottomSheetModal>
    </>
    );
  },
);

function createStyles(tokens: SignetTokens, brand: ChapterBranding) {
  const fieldStyles = sheetFieldStyles(tokens, brand.accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.sm,
    },
    ring: fieldStyles.ring,
    ringActive: fieldStyles.ringActive,
    field: {
      ...fieldStyles.field,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    fieldFocused: fieldStyles.fieldFocused,
    splitRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    splitField: {
      flex: 1,
    },
    fieldValue: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    pointsSign: {
      ...typeRole(tokens.typography.role.label),
    },
    pointsInput: {
      flex: 1,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    assigneeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    assigneeHint: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    avatar: {
      width: 26,
      height: 26,
      borderRadius: avatarRadius(26),
      backgroundColor: tokens.color.surface.popover,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: {
      // TODO-DESIGN: Canvas draws these initials at 10.5px/700; `caption` is
      // 12.5/400 and is the smallest role available.
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pickerContent: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    pickerHeader: {
      gap: tokens.spacing.sm,
      paddingBottom: tokens.spacing.sm,
      // Sticky, so it paints the sheet's own fill over the rows passing under.
      backgroundColor: tokens.color.surface.popover,
    },
    pickerEmpty: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingVertical: tokens.spacing.md,
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
  });
}
