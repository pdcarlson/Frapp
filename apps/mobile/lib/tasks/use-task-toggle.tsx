import { errorCopy, MemberFacingError } from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { AppState } from "react-native";
import { useUpdateTaskStatus, type TaskStatus } from "@repo/hooks";
import { UNDO_WINDOW_MS } from "@/components/tasks/undo-bar";
import {
  MARK_DONE_ALREADY_DONE,
  MarkDoneSheet,
  type CompletionProof,
} from "@/components/tasks/mark-done-sheet";
import { rowIsSentBack, type TaskRowModel } from "@/lib/tasks/board";
import { checkboxSequence } from "@/lib/tasks/transitions";
import {
  taskProofRefusal,
  taskStatusGateRefusal,
} from "@/lib/tasks/status-refusal";
import { markDoneAsks } from "@/lib/tasks/task-photos";
import { successHaptic } from "@/lib/haptics";

/**
 * Mark done and Mark not done, for the task board's checkbox and the task
 * screen's bar (#5492): one copy of the sequence, the proof sheet, the gate
 * refusal, the undo and the notices, so the two never disagree about what a
 * tap does. Composition stays in the screens; this is the behaviour.
 *
 * ## The checkbox is two writes, not one
 *
 * The server's assignee transition table has no `TODO → COMPLETED` edge, so
 * completing a fresh task walks `IN_PROGRESS` first. `checkboxSequence` owns
 * that ladder; this only awaits it in order, because both writes are
 * compare-and-set against the stored status and firing them in parallel loses
 * the race by construction. Each write is individually optimistic and
 * individually rolls back inside `useUpdateTaskStatus`, so if the second fails
 * after the first lands the task truly sits at `IN_PROGRESS`.
 *
 * ## Proof first, where the task asks for it
 *
 * On a task that asks for a photo or a link, or one an officer sent back,
 * Mark done opens Mark done's sheet instead (`MarkDoneHost`, #4635), which
 * takes the proof or a reply and sends it with the `COMPLETED` write. A direct
 * Mark done the server refuses for want of proof (the task changed since it
 * was read) opens the same sheet with the reason in it.
 *
 * ## Gate refusals latch (#2710)
 *
 * `PATCH /v1/tasks/:id/status` is refused, until an officer acts, by the
 * subscription gate and the module gate. The hook's optimistic write reverts
 * either way, so the caller says why (`refusal`) and offers no toggle while
 * it is set. It clears when the member comes back, to the screen (a focus) or
 * to the app (`AppState`, which a focus never sees), since an officer may have
 * sorted the gate out meanwhile. `onActive` runs on that return too, for a
 * screen's own clock, so one listener serves both.
 */

const TAKE_BACK_FAILED =
  "Couldn't mark that task not done. An officer may have confirmed it already.";
const MARK_DONE_FAILED = "Couldn't mark that task done. Try again.";

type RunOutcome = {
  outcome: "ok" | "gate" | "failed" | "skipped";
  error?: unknown;
};

export interface TaskToggle {
  /** The task with a sequence in flight, or `null`. */
  pendingId: string | null;
  /** The gate refusal's copy while it latches (#2710), or `null`. */
  refusal: string | null;
  /** A one-off line for a write that didn't land, or `null`. */
  notice: string | null;
  /** Says a line of the caller's own in the same place (a lost claim). */
  setNotice: (notice: string | null) => void;
  /**
   * The bar's offer while its window runs, or `null`: take a completion back
   * (`undo`), or give a task just claimed from Up for grabs back (`release`).
   */
  undo: {
    id: string;
    message: string;
    key: number;
    action: "undo" | "release";
  } | null;
  /** Offers Give it back on a task just claimed, in the same bar. */
  offerRelease: (id: string, message: string) => void;
  /** Takes the bar down, as its action is pressed. */
  clearUndo: () => void;
  /** Whether a toggle may be offered on this row now. */
  canToggle: (row: TaskRowModel) => boolean;
  /** Mark done, or Mark not done on a done task, as the checkbox does. */
  toggle: (row: TaskRowModel) => Promise<void>;
  /** Undo's Mark not done. */
  takeBack: (id: string) => Promise<void>;
  /** For {@link MarkDoneHost}. */
  marking: {
    id: string;
    problem: string | null;
    row: TaskRowModel;
  } | null;
  completeWithProof: (
    row: TaskRowModel,
    proof: CompletionProof,
  ) => Promise<void>;
  closeMarking: () => void;
}

export function useTaskToggle(
  /** Reads a task as it stands now, so a refetch redraws the proof sheet. */
  findRow: (id: string | null) => TaskRowModel | null,
  options: {
    /** The viewer, who alone may take back a completion of their own. */
    viewerId?: string | null;
    onActive?: () => void;
  } = {},
): TaskToggle {
  const updateStatus = useUpdateTaskStatus();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      setRefusal(null);
      setNotice(null);
      return undefined;
    }, []),
  );
  // The latest callback, read by the one listener below.
  const onActive = useRef(options.onActive);
  useEffect(() => {
    onActive.current = options.onActive;
  });
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      setRefusal(null);
      onActive.current?.();
    });
    return () => subscription.remove();
  }, []);

  /**
   * Ids with a sequence in flight. A ref rather than state because two taps
   * in one frame both observe the pre-render state: the second would start
   * its own sequence against an already-advanced task, collect a guaranteed
   * 400 from the compare-and-set, and clear the busy flag mid-write.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const [undo, setUndo] = useState<TaskToggle["undo"]>(null);
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const run = useCallback(
    async (
      id: string,
      sequence: readonly TaskStatus[],
      proof?: CompletionProof,
    ): Promise<RunOutcome> => {
      if (sequence.length === 0) return { outcome: "skipped" };
      if (inFlight.current.has(id)) return { outcome: "skipped" };

      inFlight.current.add(id);
      setPendingId(id);
      try {
        for (const status of sequence) {
          await updateStatus.mutateAsync({
            id,
            body: status === "COMPLETED" ? { status, ...proof } : { status },
          });
        }
        return { outcome: "ok" };
      } catch (error) {
        // The hook has already reverted its own write and invalidated, so the
        // task redraws at whatever the server holds. A gate refusal also says
        // why and withdraws the toggles; anything else stays a quiet revert.
        const gate = taskStatusGateRefusal(error);
        if (gate) setRefusal(gate);
        return { outcome: gate ? "gate" : "failed", error };
      } finally {
        inFlight.current.delete(id);
        setPendingId(null);
      }
    },
    [updateStatus],
  );

  const [marking, setMarking] = useState<{
    id: string;
    problem: string | null;
  } | null>(null);

  /**
   * Felt once a completion lands, and the undo offered with it. Only to the
   * assignee: the server's take-back (`COMPLETED → IN_PROGRESS`) is theirs
   * alone, and an officer who marked someone else's task done would get a
   * 400 from Undo (moving it back is Send back).
   */
  const viewerId = options.viewerId ?? null;
  const completed = useCallback(
    (row: TaskRowModel) => {
      successHaptic();
      if (viewerId === null || row.assigneeId !== viewerId) {
        setUndo((open) => (open?.id === row.id ? null : open));
        return;
      }
      setUndo((open) => ({
        id: row.id,
        message: "Marked done",
        // A new key per completion, so a second one inside the window is
        // announced again even though the words are the same.
        key: (open?.key ?? 0) + 1,
        action: "undo",
      }));
    },
    [viewerId],
  );

  const toggle = useCallback(
    async (row: TaskRowModel) => {
      const sequence = checkboxSequence(row);
      const completes = sequence[sequence.length - 1] === "COMPLETED";
      setNotice(null);
      // Unchecking is its own undo: the bar for this task has nothing left.
      if (!completes) setUndo((open) => (open?.id === row.id ? null : open));
      if (
        completes &&
        markDoneAsks({ proofKind: row.proofKind, sentBack: rowIsSentBack(row) })
      ) {
        setMarking({ id: row.id, problem: null });
        return;
      }
      const { outcome, error } = await run(row.id, sequence);
      // The confirming action (`spec/ui/mobile/README.md` § Native-feel
      // rules), felt once the server holds the task done.
      if (outcome === "ok" && completes) completed(row);
      // The task asks for proof this read didn't know of: its sheet asks.
      const proofProblem = taskProofRefusal(error);
      if (proofProblem) setMarking({ id: row.id, problem: proofProblem });
      if (outcome === "failed" && !completes) setNotice(TAKE_BACK_FAILED);
      // A 400 is the server refusing this Mark done for a reason it states
      // (#4635's compare-and-set: "This task changed…"), so it is said.
      else if (
        outcome === "failed" &&
        !proofProblem &&
        statusOf(error) === 400
      ) {
        setNotice(
          errorCopy(error, MARK_DONE_FAILED, { serverWritesForMembers: true }),
        );
      }
    },
    [run, completed],
  );

  /** Mark done from its sheet, proof attached. Rejects for the sheet to say why. */
  const completeWithProof = useCallback(
    async (row: TaskRowModel, proof: CompletionProof) => {
      const sequence = checkboxSequence(row);
      // Already done (on another device, say): the sheet says so.
      if (sequence[sequence.length - 1] !== "COMPLETED") {
        throw new MemberFacingError(MARK_DONE_ALREADY_DONE);
      }
      const { outcome, error } = await run(row.id, sequence, proof);
      if (outcome === "ok") {
        completed(row);
        return;
      }
      if (outcome !== "skipped") throw error;
    },
    [run, completed],
  );

  const takeBack = useCallback(
    async (id: string) => {
      setUndo(null);
      setNotice(null);
      // Most often refused because an officer confirmed it inside the
      // window: the bar has gone, so say so rather than leave it done.
      if ((await run(id, ["IN_PROGRESS"])).outcome === "failed") {
        setNotice(TAKE_BACK_FAILED);
      }
    },
    [run],
  );

  const canToggle = useCallback(
    (row: TaskRowModel) =>
      pendingId !== row.id &&
      refusal === null &&
      checkboxSequence(row).length > 0,
    [pendingId, refusal],
  );

  const markingRow = useMemo(
    () => findRow(marking?.id ?? null),
    [findRow, marking],
  );
  const closeMarking = useCallback(() => setMarking(null), []);

  const offerRelease = useCallback((id: string, message: string) => {
    setUndo((open) => ({
      id,
      message,
      key: (open?.key ?? 0) + 1,
      action: "release",
    }));
  }, []);
  const clearUndo = useCallback(() => setUndo(null), []);

  return {
    pendingId,
    refusal,
    notice,
    setNotice,
    undo,
    offerRelease,
    clearUndo,
    canToggle,
    toggle,
    takeBack,
    marking: marking && markingRow ? { ...marking, row: markingRow } : null,
    completeWithProof,
    closeMarking,
  };
}

/**
 * Mark done's sheet (#4635) for the task a toggle opened it on, read off the
 * caller's data so a refetch that finds the task now asks for a photo redraws
 * the sheet asking for one.
 */
export function MarkDoneHost({ toggle }: { toggle: TaskToggle }) {
  const { marking } = toggle;
  if (!marking) return null;
  const { row } = marking;
  return (
    <MarkDoneSheet
      key={marking.id}
      // Kept past a close and the screen (#5041), shared with the task's chat
      // card: Mark done on it again opens on what was added.
      keptDraft={`mark-done:${marking.id}`}
      task={{
        id: row.id,
        title: row.title,
        proofKind: row.proofKind,
        sentBack: rowIsSentBack(row),
        sentBackReason: row.sentBackReason,
        done: row.isDone,
        sentBackAt: row.sentBackAt,
      }}
      initialProblem={marking.problem}
      onComplete={(proof) => toggle.completeWithProof(row, proof)}
      onClosed={toggle.closeMarking}
    />
  );
}
