import { taskRepeatCadence, type TaskSeriesLine } from "./repeat-draft";

/**
 * What a task row says past its due, on both apps (2026-11-19, Paul: "did a
 * better job of showing details"): how it repeats, how far through its
 * checklist it is, and how many reference photos it carries. The phone's row
 * said these first (#4003, #4635, #5119); web's row read none of them, so a
 * task looked emptier on the computer than on the phone. One reading here, so
 * the two rows can't word a fact differently.
 *
 * A finished task drops all three: its status says enough.
 */
/** The mark before a repeating task's cadence on a row; spoken as "repeats". */
export const TASK_REPEAT_GLYPH = "↻";

export interface TaskRowFacts {
  /** "Weekly", "Every 2 weeks", bare. */
  cadence: string | null;
  /** "2 of 5" checklist items done. */
  progress: string | null;
  /** "1 photo", "3 photos": the task's reference photos. */
  photos: string | null;
  /** The three as a row draws them: "↻ Weekly · 2 of 5 · 1 photo". */
  shown: string | null;
  /** The three as a screen reader hears them: "repeats weekly, 2 of 5, 1 photo". */
  spoken: string | null;
}

/**
 * Each app counts its own checklist (web's rows carry `done_at`, the phone's
 * a `done` flag) and passes the counts.
 */
export function taskRowFacts(task: {
  done: boolean;
  subtasksDone: number;
  subtasksTotal: number;
  photos?: readonly { kind: string }[] | null;
  series?: TaskSeriesLine | null;
}): TaskRowFacts {
  if (task.done) {
    return {
      cadence: null,
      progress: null,
      photos: null,
      shown: null,
      spoken: null,
    };
  }
  const references = (task.photos ?? []).filter(
    (photo) => photo.kind === "reference",
  ).length;
  const cadence = taskRepeatCadence(task.series);
  const progress =
    task.subtasksTotal > 0
      ? `${task.subtasksDone} of ${task.subtasksTotal}`
      : null;
  const photos =
    references > 0
      ? `${references} ${references === 1 ? "photo" : "photos"}`
      : null;
  const join = (repeat: string | null, glue: string) =>
    [repeat, progress, photos].filter(Boolean).join(glue) || null;
  return {
    cadence,
    progress,
    photos,
    shown: join(cadence ? `${TASK_REPEAT_GLYPH} ${cadence}` : null, " · "),
    spoken: join(cadence ? `repeats ${cadence.toLowerCase()}` : null, ", "),
  };
}
