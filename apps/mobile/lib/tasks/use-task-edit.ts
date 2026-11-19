import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  dropKeptDraft,
  readKeptDraft,
  useKeptDraftKeys,
  writeKeptDraft,
} from "@repo/hooks/kept-drafts";
import {
  useRequestTaskPhotoUploadUrl,
  useUpdateTask,
  type TaskEdit,
} from "@repo/hooks";
import {
  TASK_SERIES_SCOPE_COPY,
  taskSeriesBody,
  type RepeatDraft,
  type TaskProofKind,
} from "@repo/validation";
import { askSeriesScope } from "@/lib/series-scope";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import type { TaskRowModel } from "@/lib/tasks/board";
import {
  assigneeSave,
  descriptionSave,
  dueSave,
  photosSave,
  pointsSave,
  proofSave,
  reassignRestarts,
  referencePhotos,
  repeatSave,
  rowAfter,
  scopedEdit,
  seriesScopeOf,
  TASK_EDIT_COPY,
  titleSave,
  type TaskDueDraft,
  type TaskFieldSave,
} from "@/lib/tasks/task-edit";
import {
  photoRoom,
  pickTaskPhotos,
  TASK_PHOTO_GATE_COPY,
  uploadTaskPhotos,
} from "@/lib/tasks/task-photos";

/** What the fields hold while they differ from the task; `null`, the task's. */
interface TaskEditDrafts {
  title: string | null;
  description: string | null;
  points: string | null;
  due: TaskDueDraft | null;
  /** The Repeat as picked, on a copy of a live series (#5119). */
  repeat: RepeatDraft | null;
}

type DraftKey = keyof TaskEditDrafts;

/** Every field that saves: the typed ones, and those sent as they change. */
type FieldKey = DraftKey | "proof" | "photos" | "who";

const NO_DRAFTS: TaskEditDrafts = {
  title: null,
  description: null,
  points: null,
  due: null,
  repeat: null,
};

const DRAFT_KEYS: readonly DraftKey[] = [
  "title",
  "description",
  "points",
  "due",
  "repeat",
];

/** The order a refusal is said in when more than one is open: the form's. */
const FIELD_ORDER: readonly FieldKey[] = [
  "title",
  "due",
  "repeat",
  "points",
  "description",
  "proof",
  "photos",
  "who",
];

const SENT_KEYS: readonly FieldKey[] = ["proof", "photos", "who"];

/**
 * Commit every draft: the fields together, then the Repeat (#5119). A
 * Repeat change saves to the series at once, and stopping it first would
 * leave an "All upcoming tasks" answer for the other fields nothing to
 * change (the API refuses a series edit once it has ended).
 */
async function commitDrafts(
  run: (key: DraftKey) => Promise<boolean>,
): Promise<{ key: DraftKey; ok: boolean }[]> {
  const fields = DRAFT_KEYS.filter((key) => key !== "repeat");
  const results = await Promise.all(
    fields.map(async (key) => ({ key, ok: await run(key) })),
  );
  return [...results, { key: "repeat", ok: await run("repeat") }];
}

/**
 * How long the due waits after a pick before it saves: the platform's time
 * wheel reports each stop, and only the last should be sent.
 */
const DUE_SAVE_DELAY_MS = 600;

/** The kept-drafts name an edit left unsaved is kept under (#4872). */
export const taskEditDraftName = (taskId: string) => `task-edit:${taskId}`;

function saveOf(
  key: DraftKey,
  row: TaskRowModel,
  drafts: TaskEditDrafts,
): TaskFieldSave {
  switch (key) {
    case "title":
      return titleSave(row, drafts.title ?? row.title);
    case "description":
      return descriptionSave(row, drafts.description ?? "");
    case "points":
      return pointsSave(row, drafts.points ?? "");
    case "due":
      return drafts.due
        ? dueSave(row, drafts.due, new Date())
        : { kind: "none" };
    case "repeat":
      return drafts.repeat ? repeatSave(row, drafts.repeat) : { kind: "none" };
  }
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** A field's latest save, which the next one of that field waits on. */
interface PendingSave {
  value: unknown;
  saved: Promise<boolean>;
}

export interface TaskEditing {
  drafts: TaskEditDrafts;
  /** A text field as typed; saved by `commit` (on blur or Return). */
  type: (key: "title" | "description" | "points", text: string) => void;
  /** A picked day or time, saved a moment later (`DUE_SAVE_DELAY_MS`). */
  pickDue: (next: TaskDueDraft) => void;
  /**
   * The Repeat as picked (#5119), saved with Done or as the screen goes:
   * its chips and numbers change a step at a time, and only the last of
   * them should reach the series.
   */
  pickRepeat: (next: RepeatDraft) => void;
  /** Save one field's draft, if it differs from the task. */
  commit: (key: DraftKey) => Promise<boolean>;
  /**
   * Save every field still held, and wait on every save on its way (proof,
   * photos, who included), for Done: false while one of them didn't save.
   */
  commitAll: () => Promise<boolean>;
  /**
   * A new visit to edit mode: what an earlier visit left unsaved, kept past
   * the screen, comes back as the drafts; anything else is forgotten.
   */
  begin: () => void;
  /** Drop every draft unsent: the task can no longer be edited. */
  discard: () => void;
  /** Put away what the last saves said, for the screen's next action. */
  dismiss: () => void;
  setProof: (next: TaskProofKind) => void;
  /** Take one reference photo off the task. */
  removePhoto: (photoId: string) => void;
  /** Pick photos from the library and add them to the task. */
  addPhotos: () => Promise<void>;
  /** Picked photos on their way up, drawn in the picker meanwhile. */
  uploading: readonly PickedImage[];
  /** The library is opening. */
  picking: boolean;
  /**
   * Hand the task (on a group, this copy) to another member, asking first
   * when that starts it over (`nameOf` names both in the question).
   */
  reassign: (userId: string, nameOf: (userId: string) => string) => void;
  /** A save is in flight: the screen says "Saving…". */
  saving: boolean;
  /**
   * The first field's refusal still open, in the API's words, or a field's
   * problem. It outlasts edit mode, so one landing after Done is still said.
   */
  failure: string | null;
}

/**
 * The task screen's edit (#5514): each field saves itself through
 * `PATCH /v1/tasks/:id` as it is left, as web's task panel does, with
 * `scope: "group"` on a group task's copy (`scopedEdit`). On a copy of a
 * repeating task (#5119) a save asks "This task only" or "All upcoming
 * tasks" first where web's panel does (`seriesScopeOf`), in the platform's
 * alert; Cancel keeps the draft unsaved. Saves that ask at once (Done with
 * several fields typed) share one question, and the Repeat saves after
 * them; a draft saved as the screen goes saves to this copy alone, unasked.
 * Not optimistic,
 * as `useUpdateTask` isn't: a field keeps what was typed until the save
 * lands and the task is read again, and a refusal is said in the API's
 * words with the draft kept for another try.
 *
 * A field's saves go one after another, each waiting on the one before, so
 * they land in the order they were made; and a change is measured against
 * the task as the save before it will leave it (`rowAfter`), so a change
 * back to what the task said before still sends. Each field keeps its own
 * refusal, so one field's save never clears another's.
 *
 * Held by the screen rather than the fields, so Done can save what is still
 * being typed and wait on what is on its way. A draft left when the screen
 * goes is saved then; one that can't be (offline, refused, not a number) is
 * kept past the screen under `task-edit:<id>` (#4872), and the next edit of
 * the task opens on it.
 */
export function useTaskEdit(row: TaskRowModel): TaskEditing {
  const { mutateAsync } = useUpdateTask();
  const { mutateAsync: requestPhotoUrl } = useRequestTaskPhotoUploadUrl();
  const keys = useKeptDraftKeys();
  const [drafts, setDrafts] = useState<TaskEditDrafts>(NO_DRAFTS);
  const [inFlight, setInFlight] = useState(0);
  const [failures, setFailures] = useState<Partial<Record<FieldKey, string>>>(
    {},
  );
  const [uploading, setUploading] = useState<readonly PickedImage[]>([]);
  const [picking, setPicking] = useState(false);

  // Read by the callbacks, which outlive a render: the task as last read,
  // the drafts as last typed, each field's save on its way, and what each
  // field's saves will have made of the task until it is read again.
  const rowRef = useRef(row);
  const live = useRef<TaskEditDrafts>(NO_DRAFTS);
  const pending = useRef<Partial<Record<FieldKey, PendingSave>>>({});
  const assumed = useRef<Partial<Record<FieldKey, TaskEdit>>>({});
  const upload = useRef<Promise<boolean> | null>(null);
  const failuresRef = useRef<Partial<Record<FieldKey, string>>>({});
  const dueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keptKey = useRef(keys.draft(taskEditDraftName(row.id)));
  useEffect(() => {
    rowRef.current = row;
    keptKey.current = keys.draft(taskEditDraftName(row.id));
    // A fresh read holds every save that has landed.
    for (const key of Object.keys(assumed.current) as FieldKey[]) {
      if (!pending.current[key]) delete assumed.current[key];
    }
  }, [row, keys]);

  const setFailure = useCallback((key: FieldKey, text: string | null) => {
    const next = { ...failuresRef.current };
    if (text === null) delete next[key];
    else next[key] = text;
    failuresRef.current = next;
    setFailures(next);
  }, []);

  const setDraft = useCallback(
    <K extends DraftKey>(key: K, value: TaskEditDrafts[K]) => {
      live.current = { ...live.current, [key]: value };
      setDrafts(live.current);
    },
    [],
  );

  /** The task as the saves on their way will leave it. */
  const baseline = useCallback((): TaskRowModel => {
    let task = rowRef.current;
    for (const body of Object.values(assumed.current)) {
      if (body) task = rowAfter(task, body);
    }
    return task;
  }, []);

  /** The reference photos' paths as the saves on their way leave them. */
  const storedPaths = useCallback(
    (): string[] =>
      assumed.current.photos?.reference_photo_paths ??
      referencePhotos(rowRef.current).map((photo) => photo.storage_path),
    [],
  );

  // The scope question on its way, which saves asking at once share.
  const asking = useRef<Promise<"instance" | "series" | null> | null>(null);
  const leaving = useRef(false);
  const askScope = useCallback(() => {
    if (leaving.current) return Promise.resolve("instance" as const);
    asking.current ??= askSeriesScope({
      title: TASK_SERIES_SCOPE_COPY.saveTitle,
      message: TASK_SERIES_SCOPE_COPY.saveMessage,
      thisOne: TASK_SERIES_SCOPE_COPY.thisTask,
      allUpcoming: TASK_SERIES_SCOPE_COPY.allUpcoming,
    }).finally(() => {
      asking.current = null;
    });
    return asking.current;
  }, []);

  const send = useCallback(
    async (key: FieldKey, body: TaskEdit): Promise<boolean> => {
      const task = rowRef.current;
      setFailure(key, null);
      let request = scopedEdit(task, body);
      if (task.groupId === null) {
        const decided = seriesScopeOf(task, body);
        if (decided.kind === "refuse") {
          setFailure(key, decided.message);
          return false;
        }
        const scope = decided.kind === "ask" ? await askScope() : decided.kind;
        // Cancel: the draft stays, unsaved, and nothing failed.
        if (scope === null) return false;
        if (scope === "series") request = taskSeriesBody(body);
      }
      setInFlight((count) => count + 1);
      try {
        await mutateAsync({ id: task.id, body: request });
        return true;
      } catch (error) {
        // The API's own sentence where it wrote one for members ("Every
        // copy is already confirmed…"), else the fallback.
        setFailure(
          key,
          errorCopy(error, TASK_EDIT_COPY.failed, {
            serverWritesForMembers: true,
          }),
        );
        return false;
      } finally {
        setInFlight((count) => count - 1);
      }
    },
    [mutateAsync, setFailure, askScope],
  );

  /** Send after this field's save before it, whatever that one's outcome. */
  const enqueue = useCallback(
    async (key: FieldKey, value: unknown, body: TaskEdit): Promise<boolean> => {
      const before = pending.current[key]?.saved;
      assumed.current[key] = body;
      // At once with none before it, so the request leaves on the tap.
      const saved = before
        ? before.then(() => send(key, body))
        : send(key, body);
      pending.current[key] = { value, saved };
      const ok = await saved;
      if (pending.current[key]?.saved === saved) {
        delete pending.current[key];
        // The last of this field's saves failed: the task stands as read.
        if (!ok) delete assumed.current[key];
      }
      return ok;
    },
    [send],
  );

  /** A change that isn't a draft (proof, photos, who): sent at once. */
  const sendField = useCallback(
    async (key: FieldKey, result: TaskFieldSave): Promise<boolean> => {
      if (result.kind === "none") return pending.current[key]?.saved ?? true;
      if (result.kind === "problem") {
        setFailure(key, result.message);
        return false;
      }
      return enqueue(key, result.body, result.body);
    },
    [enqueue, setFailure],
  );

  const commit = useCallback(
    async (key: DraftKey): Promise<boolean> => {
      if (key === "due" && dueTimer.current) {
        clearTimeout(dueTimer.current);
        dueTimer.current = null;
      }
      const value = live.current[key];
      const flying = pending.current[key];
      if (value === null) return flying?.saved ?? true;
      // Already on its way: Done right after a blur sends it once, and
      // waits on that save rather than closing before it lands.
      if (flying && same(flying.value, value)) return flying.saved;
      const result = saveOf(key, baseline(), live.current);
      if (result.kind === "problem") {
        setFailure(key, result.message);
        return false;
      }
      setFailure(key, null);
      const ok =
        result.kind === "none"
          ? await (flying?.saved ?? Promise.resolve(true))
          : await enqueue(key, value, result.body);
      // Saved: the field shows the task, read again by now. Typed over
      // meanwhile: what was typed since stays to be saved.
      if (ok && same(live.current[key], value)) setDraft(key, null);
      return ok;
    },
    [baseline, enqueue, setDraft, setFailure],
  );

  const commitAll = useCallback(async () => {
    // The saves already on their way are taken now: one that settles while
    // the drafts save still counts.
    const onTheirWay = [
      ...SENT_KEYS.map((key) => pending.current[key]?.saved ?? true),
      upload.current ?? true,
    ];
    const typed = (await commitDrafts(commit)).map(({ ok }) => ok);
    const sent = await Promise.all([
      ...onTheirWay,
      ...SENT_KEYS.map((key) => pending.current[key]?.saved ?? true),
      upload.current ?? true,
    ]);
    return [...typed, ...sent].every(Boolean);
  }, [commit]);

  // A draft left as the screen goes (back with the keyboard up, or a day
  // picked a moment ago) is saved then, as every field saves as it is left;
  // one that doesn't save is kept for the next edit of the task.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(
    () => () => {
      const left = live.current;
      const name = keptKey.current;
      // No question once the screen is gone: an alert over another screen
      // wouldn't say which task it means. What is left saves to this copy
      // alone, as the phone's edit did before it asked (#5119).
      leaving.current = true;
      void commitDrafts(async (key) =>
        left[key] === null ? true : commitRef.current(key),
      ).then((results) => {
        const unsaved = results.filter(({ ok }) => !ok);
        if (unsaved.length === 0) return;
        const kept: Partial<TaskEditDrafts> = {};
        for (const { key } of unsaved)
          Object.assign(kept, { [key]: left[key] });
        writeKeptDraft(name, {
          ...(readKeptDraft<Partial<TaskEditDrafts>>(name) ?? {}),
          ...kept,
        });
      });
    },
    [],
  );

  const type = useCallback(
    (key: "title" | "description" | "points", text: string) => {
      setFailure(key, null);
      setDraft(key, text);
    },
    [setDraft, setFailure],
  );

  const pickDue = useCallback(
    (next: TaskDueDraft) => {
      setFailure("due", null);
      setDraft("due", next);
      if (dueTimer.current) clearTimeout(dueTimer.current);
      dueTimer.current = setTimeout(() => {
        dueTimer.current = null;
        void commit("due");
      }, DUE_SAVE_DELAY_MS);
    },
    [commit, setDraft, setFailure],
  );

  const pickRepeat = useCallback(
    (next: RepeatDraft) => {
      setFailure("repeat", null);
      setDraft("repeat", next);
    },
    [setDraft, setFailure],
  );

  const discard = useCallback(() => {
    if (dueTimer.current) clearTimeout(dueTimer.current);
    dueTimer.current = null;
    live.current = NO_DRAFTS;
    setDrafts(NO_DRAFTS);
  }, []);

  const dismiss = useCallback(() => {
    failuresRef.current = {};
    setFailures({});
  }, []);

  const begin = useCallback(() => {
    discard();
    dismiss();
    const name = keptKey.current;
    const kept = readKeptDraft<Partial<TaskEditDrafts>>(name);
    if (!kept) return;
    dropKeptDraft(name);
    live.current = { ...NO_DRAFTS, ...kept };
    setDrafts(live.current);
  }, [discard, dismiss]);

  const setProof = useCallback(
    (next: TaskProofKind) =>
      void sendField("proof", proofSave(baseline(), next)),
    [sendField, baseline],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const path = referencePhotos(rowRef.current).find(
        (photo) => photo.id === photoId,
      )?.storage_path;
      if (!path) return;
      const stored = storedPaths();
      void sendField(
        "photos",
        photosSave(
          stored,
          stored.filter((each) => each !== path),
        ),
      );
    },
    [sendField, storedPaths],
  );

  const addPhotos = useCallback(async () => {
    if (picking || upload.current) return;
    setFailure("photos", null);
    setPicking(true);
    const room = photoRoom(storedPaths().length);
    let picked;
    try {
      picked = await pickTaskPhotos(room);
    } finally {
      setPicking(false);
    }
    if (picked.status === "refused") {
      setFailure("photos", picked.reason);
      return;
    }
    if (picked.status !== "picked" || picked.images.length === 0) return;
    const pick = picked;
    const images = pick.images.slice(0, room);
    setUploading(images);
    // Done waits on the whole of it: the upload, then the save.
    const run = (async (): Promise<boolean> => {
      const up = await uploadTaskPhotos(
        images.map((image) => ({ image })),
        (request) => requestPhotoUrl(request),
        TASK_PHOTO_GATE_COPY.task,
      );
      if (up.status !== "uploaded") {
        setFailure("photos", up.reason);
        return false;
      }
      // The task's own as they will stand, then the new ones: a photo
      // removed while these went up stays removed.
      const stored = storedPaths();
      const ok = await sendField(
        "photos",
        photosSave(stored, [...stored, ...up.paths]),
      );
      // `refused`: some were turned down at the pick (type, size).
      if (ok && pick.refused) setFailure("photos", pick.refused);
      return ok;
    })();
    upload.current = run;
    try {
      await run;
    } finally {
      upload.current = null;
      setUploading([]);
    }
  }, [picking, storedPaths, requestPhotoUrl, sendField, setFailure]);

  const reassign = useCallback(
    (userId: string, nameOf: (userId: string) => string) => {
      const task = baseline();
      const result = assigneeSave(task, userId);
      if (result.kind !== "save") return;
      if (!reassignRestarts(task)) {
        void sendField("who", result);
        return;
      }
      // The platform alert, as web's panel asks: the task starts over at To
      // do, and its assignee's progress doesn't carry.
      Alert.alert(
        `Give it to ${nameOf(userId)}?`,
        `It starts over at To do. ${task.assigneeId ? `${nameOf(task.assigneeId)}'s progress doesn't carry.` : ""}`.trim(),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Give it to them",
            onPress: () => void sendField("who", result),
          },
        ],
      );
    },
    [sendField, baseline],
  );

  const failure =
    FIELD_ORDER.map((key) => failures[key]).find(
      (text): text is string => text !== undefined,
    ) ?? null;

  return {
    drafts,
    type,
    pickDue,
    pickRepeat,
    commit,
    commitAll,
    begin,
    discard,
    dismiss,
    setProof,
    removePhoto,
    addPhotos,
    uploading,
    picking,
    reassign,
    saving: inFlight > 0 || uploading.length > 0,
    failure,
  };
}
