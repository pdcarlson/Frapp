import { forwardRef, useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { codeOf } from "@repo/api-sdk";
import { SignetTokens } from "@repo/theme/signet";
import {
  AI_SUGGESTION_COPY,
  TASK_PHOTOS_MAX,
  TASK_PROOF_KIND_LABELS,
  TASK_PROOF_KINDS,
  aiSuggestionRefusalLine,
  type TaskProofKind,
} from "@repo/validation";
import {
  memberFallbackLabel,
  useChapterRoster,
  useCreateTask,
  useRequestTaskPhotoUploadUrl,
  useUpdateTask,
  useViewerUserId,
  type LiveTaskPhoto,
} from "@repo/hooks";
import type { DispatchResult, TaskInput } from "@repo/chat-core/dispatch";
import {
  avatarRadius,
  fieldTypeRole,
  typeRole,
  useFrappTheme,
} from "@/lib/theme";
import {
  useChapterBranding,
  type ChapterBranding,
} from "@/lib/chapter-branding";
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
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { DueDateField } from "@/components/tasks/due-date-field";
import { DueTimeField } from "@/components/tasks/due-time-field";
import { SubtaskDraftField } from "@/components/tasks/subtask-draft-field";
import { TaskPhotoPicker } from "@/components/tasks/task-photos";
import { Segmented } from "@/components/segmented";
import {
  PROOF_KIND_HINTS,
  photoRoom,
  pickTaskPhotos,
  uploadTaskPhotos,
  TASK_PHOTO_GATE_COPY,
  type PendingTaskPhoto,
} from "@/lib/tasks/task-photos";
import {
  dueTimePassed,
  localIsoDate,
  suggestedDueTime,
} from "@repo/formatting";
import { TITLE_MAX_LENGTH } from "@/lib/tasks/limits";
import {
  DEFAULT_DUE_CHOICE,
  dueChoiceOf,
  editDraftOf,
  taskEditBody,
  type TaskEditTarget,
  duePresets,
  parsePointReward,
  resolveDue,
  validateNewTask,
  type DueChoice,
  type ValidatedNewTask,
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
 * ## The due date
 *
 * The drawn free date field, as the platform's picker (`due-date-field.tsx`,
 * #3597), with the preset chips under it kept as quick picks: most tasks are
 * due today, tomorrow or this week, and a chip is one tap.
 *
 * ## One deviation from the drawing, forced
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
  /**
   * Set when the sheet was opened from a chat's + (#3865): the create goes
   * through chat-core's `postTask` into that channel, the call web's `/task`
   * makes, so its card gets the thread's placeholder. A refusal keeps the
   * draft, as a create from the quick actions does; anything else is a task
   * that may exist (neither route dedupes), so the sheet closes and hands the
   * result to `onPosted` to say what it carries (`warning`, `unconfirmed`).
   */
  postToChannel?: (input: TaskInput) => Promise<DispatchResult>;
  onPosted?: (result: DispatchResult) => void;
  /**
   * Edit this task instead of making one (#4296): the same fields, opened on
   * the task as it stands, titled "Edit task" and saved with Save. Steps are
   * added and removed in the task's own sheet, so the subtask field is left
   * out. The host mounts one sheet per task edited (`key` on its id), so the
   * draft starts from the task, and a close gives it up.
   */
  editing?: TaskEditTarget;
  /** Fired after an edit saves. */
  onSaved?: () => void;
  /**
   * Accept a suggested task through the form (#4313): the fields open on what
   * the minutes suggested, titled "Change before accepting", and the button
   * accepts. Who it is for starts empty when the meeting named nobody, never
   * on the viewer: a wrong owner is worse than none. Points are left out (a
   * suggestion carries none). The host mounts one sheet per suggestion
   * (`key` on its id).
   */
  suggestion?: TaskSuggestionSeed;
  /** Fired when the sheet has closed, however it closed. */
  onClosed?: () => void;
}

export interface TaskSuggestionSeed {
  title: string;
  assigneeId: string | null;
  /** `YYYY-MM-DD`, or null when the meeting gave no day. */
  dueDay: string | null;
  dueAt: string | null;
  subtasks: readonly string[];
  /**
   * Accepts the suggestion as the form stands. Rejects with the server's
   * error, whose refusal codes the sheet puts into words.
   */
  accept: (task: ValidatedNewTask) => Promise<void>;
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
  function NewTaskSheet(
    {
      now,
      onCreated,
      postToChannel,
      onPosted,
      editing,
      onSaved,
      onClosed,
      suggestion,
    },
    ref,
  ) {
    const { tokens } = useFrappTheme();
    const brand = useChapterBranding();
    const { accent } = brand;
    const styles = createStyles(tokens, brand);
    const backgroundStyle = useSheetBackgroundStyle();
    const pickerSheet = useTallSheetProps();
    const pickerRef = useRef<BottomSheetModal>(null);
    const closeSheet = useSheetClose(ref);
    const closePicker = useSheetClose(pickerRef);
    const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
      useSheetVisit(ref);

    const viewerUserId = useViewerUserId();
    const rosterQuery = useChapterRoster();
    const createTask = useCreateTask();
    const updateTask = useUpdateTask();
    // The task as it stands, as the fields start (an edit only).
    const original = useMemo(
      () => (editing ? editDraftOf(editing) : null),
      [editing],
    );
    // What the minutes suggested, as the fields start (a suggestion only).
    const suggested = useMemo(
      () =>
        suggestion?.dueDay
          ? editDraftOf({
              id: "",
              title: suggestion.title,
              assigneeId: suggestion.assigneeId ?? "",
              dueDay: suggestion.dueDay,
              dueAt: suggestion.dueAt,
              pointReward: null,
              storedStatus: null,
              referencePhotos: [],
              proofKind: "none",
            })
          : null,
      [suggestion],
    );
    // `postToChannel` isn't a mutation, so its flight is held here.
    const [posting, setPosting] = useState(false);

    // Read when the host's clock moves rather than per render, so the presets
    // cannot shift under the member mid-edit.
    const at = useMemo(() => now ?? new Date(), [now]);
    const presets = useMemo(() => duePresets(at), [at]);

    const [title, setTitle] = useState(
      original?.title ?? suggestion?.title ?? "",
    );
    const [pointsInput, setPointsInput] = useState(original?.pointsInput ?? "");
    // The chip as the draft holds it, resolved against today's below.
    const [due, setDue] = useState<DueChoice>(
      original
        ? { kind: "date", date: original.dueDate }
        : suggested
          ? { kind: "date", date: suggested.dueDate }
          : DEFAULT_DUE_CHOICE,
    );
    // `HH:MM`, or null for a task due by the day (#4003).
    const [dueTime, setDueTime] = useState<string | null>(
      original?.dueTime ?? suggested?.dueTime ?? null,
    );
    // The steps (#4003), and the one being typed, which sends as the last.
    const [subtasks, setSubtasks] = useState<string[]>(() => [
      ...(suggestion?.subtasks ?? []),
    ]);
    const [subtaskText, setSubtaskText] = useState("");
    // Defaults to the viewer, so the common case needs no picker interaction.
    const [assigneeId, setAssigneeId] = useState<string | null>(
      original?.assigneeId ?? suggestion?.assigneeId ?? null,
    );
    // Photos and proof (#4635): the task's own reference photos still kept
    // (an edit), the ones picked here, which go up on Save, and the proof
    // control. A suggestion carries none, so its form leaves them out.
    const [proofKind, setProofKind] = useState<TaskProofKind>(
      original?.proofKind ?? "none",
    );
    const [keptPhotos, setKeptPhotos] = useState<LiveTaskPhoto[]>(
      () => editing?.referencePhotos ?? [],
    );
    const [pickedPhotos, setPickedPhotos] = useState<PendingTaskPhoto[]>([]);
    const [photoProblem, setPhotoProblem] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [addingPhotos, setAddingPhotos] = useState(false);
    const pickingPhotos = useRef(false);
    const requestPhotoUrl = useRequestTaskPhotoUploadUrl();
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

    // A suggestion the meeting named nobody for stays unassigned until the
    // officer picks: defaulting it to them would be a guess.
    const effectiveAssigneeId =
      assigneeId ?? (suggestion ? null : viewerUserId);
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
          : suggestion
            ? AI_SUGGESTION_COPY.who
            : "Member"));

    // See the header: a relative chip re-reads today, a held date stays put.
    //
    // An edit keeps a task's own due date even once it has passed: an
    // overdue task's title or points can change without moving it to today.
    const keepsPastDue =
      original !== null &&
      due.kind === "date" &&
      due.date === original.dueDate &&
      due.date < localIsoDate(at);
    const { date: dueDate, chipId: dueChipId } = keepsPastDue
      ? { date: original.dueDate, chipId: null }
      : resolveDue(due, at);
    const pending =
      createTask.isPending || updateTask.isPending || posting || uploading;

    const draft = {
      title,
      dueDate,
      dueTime,
      subtasks: [...subtasks, subtaskText],
      assigneeId: effectiveAssigneeId,
      pointsInput,
      proofKind,
    };
    const body = validateNewTask(draft, at, original ?? undefined);
    const timePassed = dueTimePassed(draft, at, original ?? undefined);
    // A new assignee starts a task that is under way over (the API resets
    // it), so the sheet says so before Save rather than after.
    const restarts =
      editing !== undefined &&
      effectiveAssigneeId !== editing.assigneeId &&
      editing.storedStatus !== null &&
      editing.storedStatus !== "TODO";
    const pointsInvalid = parsePointReward(pointsInput).kind === "invalid";
    const canSubmit = body !== null && !pending && refusal === null;

    /** The draft itself: what a create sends. */
    const clearDraft = useCallback(() => {
      setTitle("");
      setPointsInput("");
      setDue(DEFAULT_DUE_CHOICE);
      setDueTime(null);
      setSubtasks([]);
      setSubtaskText("");
      setAssigneeId(null);
      setProofKind("none");
      setPickedPhotos([]);
      setPhotoProblem(null);
    }, []);

    /** Add photos from the library, several at once, up to the room left. */
    const addPhotos = useCallback(async () => {
      if (pickingPhotos.current || sending.current) return;
      pickingPhotos.current = true;
      setAddingPhotos(true);
      try {
        const result = await pickTaskPhotos(
          photoRoom(keptPhotos.length + pickedPhotos.length),
        );
        if (result.status === "picked") {
          setPickedPhotos((current) => [
            ...current,
            ...result.images
              .slice(0, photoRoom(keptPhotos.length + current.length))
              .map((image) => ({ image })),
          ]);
          setPhotoProblem(result.refused);
        } else if (result.status === "refused") {
          setPhotoProblem(result.reason);
        }
      } finally {
        pickingPhotos.current = false;
        setAddingPhotos(false);
      }
    }, [keptPhotos.length, pickedPhotos.length]);

    /**
     * The body with its `reference_photo_paths` (#4635): the newly uploaded
     * ones on a create, the whole set as it should stand on an edit.
     */
    const attachPhotos = useCallback(
      (base: ValidatedNewTask, paths: string[]): ValidatedNewTask => {
        if (editing) {
          return {
            ...base,
            reference_photo_paths: [
              ...keptPhotos.map((photo) => photo.storage_path),
              ...paths,
            ],
          };
        }
        return paths.length > 0
          ? { ...base, reference_photo_paths: paths }
          : base;
      },
      [editing, keptPhotos],
    );

    /**
     * Uploads the photos picked here that aren't up yet: their paths, in
     * order, or `null` when one didn't go, having said why. A gate's refusal
     * takes the button, as a create's does.
     */
    const uploadPicked = useCallback(async (): Promise<string[] | null> => {
      setUploading(true);
      setPhotoProblem(null);
      const up = await uploadTaskPhotos(
        pickedPhotos,
        (request) => requestPhotoUrl.mutateAsync(request),
        TASK_PHOTO_GATE_COPY.task,
      );
      setUploading(false);
      setPickedPhotos(up.photos);
      if (up.status === "uploaded") return up.paths;
      if (up.final) setRefusal(up.reason);
      else setPhotoProblem(up.reason);
      return null;
    }, [pickedPhotos, requestPhotoUrl]);

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
      onClosed?.();
    }, [markClosed, onClosed]);

    // Held while a create runs (`cancelDisabled` below; the header says
    // why). `sending` covers a tap in the same batch as Create, before
    // `isPending` reaches a render.
    const cancel = useCallback(() => {
      if (sending.current) return;
      // An edit's draft goes with its sheet (the host unmounts it on close),
      // so its fields keep the task's values while the sheet slides away.
      if (!editing) reset();
      dismiss();
    }, [reset, dismiss, editing]);

    /** Sends the body, photos already up, by whichever route opened the sheet. */
    const dispatchBody = useCallback(
      (
        body: ValidatedNewTask,
        sentFrom: number,
        handlers: {
          onSuccess: (posted?: DispatchResult) => void;
          onError: (error: unknown) => void;
        },
      ) => {
        if (editing) {
          const changes = taskEditBody(editing, body);
          if (Object.keys(changes).length === 0) {
            sending.current = false;
            dismiss();
            return;
          }
          updateTask.mutate(
            { id: editing.id, body: changes },
            {
              onSuccess: () => {
                sending.current = false;
                successHaptic();
                if (isSameVisit(sentFrom)) dismiss();
                onSaved?.();
              },
              onError: handlers.onError,
            },
          );
          return;
        }
        if (suggestion) {
          setPosting(true);
          void suggestion.accept(body).then(
            () => {
              setPosting(false);
              handlers.onSuccess();
            },
            (error: unknown) => {
              setPosting(false);
              // Decided by someone else, expired, or its minutes changed:
              // asking again can't work, so the reason takes the button.
              const line = aiSuggestionRefusalLine(codeOf(error));
              if (line && isSameVisit(sentFrom)) {
                sending.current = false;
                setRefusal(line);
                return;
              }
              handlers.onError(error);
            },
          );
          return;
        }
        if (!postToChannel) {
          createTask.mutate(body, {
            onSuccess: () => handlers.onSuccess(),
            onError: handlers.onError,
          });
          return;
        }
        setPosting(true);
        void postToChannel(body)
          .catch((cause: unknown): DispatchResult => ({
            ok: false,
            error: "Couldn't create task",
            cause,
          }))
          .then((result) => {
            setPosting(false);
            if (!result.ok) {
              handlers.onError(result.cause ?? new Error(result.error));
              return;
            }
            handlers.onSuccess(result);
          });
      },
      [
        createTask,
        dismiss,
        isSameVisit,
        postToChannel,
        editing,
        updateTask,
        onSaved,
        suggestion,
      ],
    );

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
      const handlers = {
        onSuccess: (posted?: DispatchResult) => {
          sending.current = false;
          const wasSelf = body.assignee_id === viewerUserId;
          // The confirming action (`spec/ui/mobile/README.md` § Native-feel
          // rules), felt once the task exists.
          // Not for a lost answer: the task may not exist.
          if (!posted?.unconfirmed) successHaptic();
          // The draft was saved, so it goes whichever visit is on screen:
          // keeping it would invite a duplicate. A visit reopened since is
          // read-only until now (see the header), so it still holds what
          // was sent.
          clearDraft();
          // A sheet closed and reopened since is the member's new visit, and
          // the create doesn't close it under them.
          if (isSameVisit(sentFrom)) dismiss();
          onCreated?.(assigneeName, wasSelf);
          if (posted) onPosted?.(posted);
        },
        onError: (error: unknown) => {
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
      };
      // Photos already up (or none picked) send in this tap; any still on
      // the device go up first.
      const uploaded = pickedPhotos.flatMap((photo) =>
        photo.storagePath ? [photo.storagePath] : [],
      );
      if (uploaded.length === pickedPhotos.length) {
        dispatchBody(attachPhotos(body, uploaded), sentFrom, handlers);
        return;
      }
      void uploadPicked().then((paths) => {
        if (!paths) {
          sending.current = false;
          return;
        }
        dispatchBody(attachPhotos(body, paths), sentFrom, handlers);
      });
    }, [
      body,
      canSubmit,
      visit,
      pickedPhotos,
      attachPhotos,
      uploadPicked,
      dispatchBody,
      viewerUserId,
      clearDraft,
      isSameVisit,
      dismiss,
      onCreated,
      assigneeName,
      onPosted,
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
          stackBehavior={SHEET_STACK_BEHAVIOR}
          enableDynamicSizing
          keyboardBehavior="interactive"
          backgroundStyle={backgroundStyle}
          handleComponent={SheetGrabber}
          backdropComponent={SheetScrim}
          onAnimate={onAnimate}
          onDismiss={closed}
        >
          <SheetBackToClose onClose={closeSheet} />
          <BottomSheetView
            onAccessibilityEscape={closeSheet}
            style={styles.body}
          >
            <SheetHeader
              title={
                editing
                  ? "Edit task"
                  : suggestion
                    ? AI_SUGGESTION_COPY.change
                    : "New task"
              }
              onCancel={cancel}
              cancelDisabled={pending}
            />

            {/* The focus ring is the wrapper, not the field — see the header. It
              tracks real focus rather than "has text", which would leave the
              ring lit on a filled field nobody is editing. */}
            <View
              style={[styles.ring, titleFocused ? styles.ringActive : null]}
            >
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
                <DueDateField
                  value={dueDate}
                  today={localIsoDate(at)}
                  disabled={pending}
                  onChange={(date) => setDue({ kind: "date", date })}
                />
              </View>

              {suggestion ? null : (
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
              )}
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

            <View style={styles.field}>
              <DueTimeField
                value={dueTime}
                suggested={suggestedDueTime(dueDate, at)}
                disabled={pending}
                onChange={setDueTime}
              />
            </View>

            {editing ? null : (
              <SubtaskDraftField
                items={subtasks}
                onChange={setSubtasks}
                text={subtaskText}
                onTextChange={setSubtaskText}
                disabled={pending}
                fieldStyle={styles.field}
              />
            )}

            {/* Photos of what the job is, and what Mark done needs (#4635),
              the way Google Classroom and Canvas set what a submission takes.
              Web puts them under More options; this sheet has none, so they
              sit here, quiet until used. */}
            {suggestion ? null : (
              <>
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Photos</Text>
                  <Text style={styles.note}>
                    What the job looks like (optional, up to {TASK_PHOTOS_MAX}).
                  </Text>
                  <TaskPhotoPicker
                    taskId={editing?.id}
                    kept={keptPhotos}
                    picked={pickedPhotos.map(({ image }) => image)}
                    onRemoveKept={(photoId) =>
                      setKeptPhotos((current) =>
                        current.filter((photo) => photo.id !== photoId),
                      )
                    }
                    onRemovePicked={(index) =>
                      setPickedPhotos((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                    onAdd={() => void addPhotos()}
                    disabled={pending}
                    adding={addingPhotos}
                  />
                  {photoProblem ? (
                    <Text style={styles.error}>{photoProblem}</Text>
                  ) : null}
                </View>

                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Proof</Text>
                  <Segmented
                    options={TASK_PROOF_KINDS.map((kind) => ({
                      value: kind,
                      label: TASK_PROOF_KIND_LABELS[kind],
                    }))}
                    value={proofKind}
                    onChange={setProofKind}
                    accessibilityLabel="Proof to mark it done"
                    disabled={pending}
                  />
                  <Text style={styles.note}>{PROOF_KIND_HINTS[proofKind]}</Text>
                </View>
              </>
            )}

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
                <Text style={styles.avatarText}>
                  {initialsFor(assigneeName)}
                </Text>
              </View>
              <Text style={styles.fieldValue} numberOfLines={1}>
                {assigneeLabel}
              </Text>
              <Text style={styles.assigneeHint}>assignee</Text>
            </Pressable>

            {restarts ? (
              <Text style={styles.note}>
                Saving starts it over at To do for {assigneeLabel}.
              </Text>
            ) : null}

            {timePassed ? (
              <Text style={styles.error}>
                That time has already passed today. Pick a later time or another
                day.
              </Text>
            ) : null}

            {pointsInvalid ? (
              <Text style={styles.error}>
                Points must be a whole number, up to 100,000.
              </Text>
            ) : null}

            {refusal ? <Text style={styles.error}>{refusal}</Text> : null}

            {submitFailed ? (
              <Text style={styles.error}>
                {editing
                  ? "That didn't save. Your changes are still here. Try again."
                  : "That didn't save. Your task is still here — try again."}
              </Text>
            ) : null}

            <SheetPrimaryButton
              label={
                editing
                  ? updateTask.isPending
                    ? "Saving…"
                    : "Save"
                  : suggestion
                    ? posting
                      ? AI_SUGGESTION_COPY.accepting
                      : AI_SUGGESTION_COPY.accept
                    : createTask.isPending
                      ? "Creating…"
                      : "Create task"
              }
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
          stackBehavior={SHEET_STACK_BEHAVIOR}
          // A tall sheet (`components.md` § Surface size): the whole roster,
          // and a search the keyboard would otherwise squeeze into a sliver of
          // the old 70% box.
          {...pickerSheet}
          keyboardBehavior="interactive"
          backgroundStyle={backgroundStyle}
          handleComponent={SheetGrabber}
          backdropComponent={SheetScrim}
        >
          <SheetBackToClose onClose={closePicker} />
          <BottomSheetFlatList
            onAccessibilityEscape={closePicker}
            data={filteredRoster}
            keyExtractor={(row: RosterMember) => row.userId}
            contentContainerStyle={styles.pickerContent}
            keyboardShouldPersistTaps="handled"
            // The title and search stay pinned while the roster scrolls under
            // them, so the field is still there after a long scroll.
            stickyHeaderIndices={[0]}
            ListHeaderComponent={
              <View style={styles.pickerHeader}>
                <TallSheetHeader title="Assign to" onClose={closePicker} />
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
                  <Text style={styles.avatarText}>
                    {initialsFor(item.name)}
                  </Text>
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
      // No lineHeight on a single-line input, or iOS draws the text low.
      ...fieldTypeRole(tokens.typography.role.body),
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
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    groupLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
