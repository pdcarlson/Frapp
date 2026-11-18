import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { errorCopy } from "@repo/hooks/error-copy";
import {
  useRequestTaskPhotoUploadUrl,
  useUpdateTask,
  type TaskEdit,
} from "@repo/hooks";
import type { TaskProofKind } from "@repo/validation";
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
  scopedEdit,
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
}

type DraftKey = keyof TaskEditDrafts;

const NO_DRAFTS: TaskEditDrafts = {
  title: null,
  description: null,
  points: null,
  due: null,
};

const DRAFT_KEYS: readonly DraftKey[] = [
  "title",
  "description",
  "points",
  "due",
];

/**
 * How long the due waits after a pick before it saves: the platform's time
 * wheel reports each stop, and only the last should be sent.
 */
const DUE_SAVE_DELAY_MS = 600;

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
  }
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export interface TaskEditing {
  drafts: TaskEditDrafts;
  /** A text field as typed; saved by `commit` (on blur or Return). */
  type: (key: "title" | "description" | "points", text: string) => void;
  /** A picked day or time, saved a moment later (`DUE_SAVE_DELAY_MS`). */
  pickDue: (next: TaskDueDraft) => void;
  /** Save one field's draft, if it differs from the task. */
  commit: (key: DraftKey) => Promise<boolean>;
  /** Save every field still held, for Done: false while one didn't save. */
  commitAll: () => Promise<boolean>;
  /** Forget every draft, for a new visit to edit mode. */
  reset: () => void;
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
   * Hand the task to another member, asking first when that starts it over
   * (`nameOf` names both in the question).
   */
  reassign: (userId: string, nameOf: (userId: string) => string) => void;
  /** A save is in flight: the screen says "Saving…". */
  saving: boolean;
  /** The last save's refusal, in the API's words, or a field's problem. */
  failure: string | null;
}

/**
 * The task screen's edit (#5514): each field saves itself through
 * `PATCH /v1/tasks/:id` as it is left, as web's task panel does, with
 * `scope: "group"` on a group task's copy (`scopedEdit`). Not optimistic,
 * as `useUpdateTask` isn't: a field keeps what was typed until the save
 * lands and the task is read again, and a refusal is said in the API's
 * words with the draft kept for another try.
 *
 * Held by the screen rather than the fields, so Done can save what is still
 * being typed, and a draft left when the screen goes is saved then.
 */
export function useTaskEdit(row: TaskRowModel): TaskEditing {
  const { mutateAsync } = useUpdateTask();
  const { mutateAsync: requestPhotoUrl } = useRequestTaskPhotoUploadUrl();
  const [drafts, setDrafts] = useState<TaskEditDrafts>(NO_DRAFTS);
  const [inFlight, setInFlight] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [uploading, setUploading] = useState<readonly PickedImage[]>([]);
  const [picking, setPicking] = useState(false);

  // Read by the callbacks, which outlive a render: the task as last read,
  // the drafts as last typed, and what is on its way.
  const rowRef = useRef(row);
  useEffect(() => {
    rowRef.current = row;
  }, [row]);
  const live = useRef<TaskEditDrafts>(NO_DRAFTS);
  // Each field's save on its way, and what it sent.
  const sent = useRef<
    Partial<Record<DraftKey, { value: unknown; saved: Promise<boolean> }>>
  >({});
  const dueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDraft = useCallback(
    <K extends DraftKey>(key: K, value: TaskEditDrafts[K]) => {
      live.current = { ...live.current, [key]: value };
      setDrafts(live.current);
    },
    [],
  );

  const send = useCallback(
    async (body: TaskEdit): Promise<boolean> => {
      const task = rowRef.current;
      setFailure(null);
      setInFlight((count) => count + 1);
      try {
        await mutateAsync({ id: task.id, body: scopedEdit(task, body) });
        return true;
      } catch (error) {
        // The API's own sentence where it wrote one for members ("Every
        // copy is already confirmed…"), else the fallback.
        setFailure(
          errorCopy(error, TASK_EDIT_COPY.failed, {
            serverWritesForMembers: true,
          }),
        );
        return false;
      } finally {
        setInFlight((count) => count - 1);
      }
    },
    [mutateAsync],
  );

  /** A change that isn't a draft (proof, photos, who): sent at once. */
  const sendNow = useCallback(
    async (result: TaskFieldSave): Promise<boolean> => {
      if (result.kind === "none") return true;
      if (result.kind === "problem") {
        setFailure(result.message);
        return false;
      }
      return send(result.body);
    },
    [send],
  );

  const commit = useCallback(
    async (key: DraftKey): Promise<boolean> => {
      if (key === "due" && dueTimer.current) {
        clearTimeout(dueTimer.current);
        dueTimer.current = null;
      }
      const value = live.current[key];
      if (value === null) return true;
      // Already on its way: Done right after a blur sends it once, and
      // waits on that save rather than closing before it lands.
      const flying = sent.current[key];
      if (flying && same(flying.value, value)) return flying.saved;
      const result = saveOf(key, rowRef.current, live.current);
      if (result.kind === "none") {
        setDraft(key, null);
        return true;
      }
      if (result.kind === "problem") {
        setFailure(result.message);
        return false;
      }
      const saved = send(result.body);
      sent.current[key] = { value, saved };
      const ok = await saved;
      if (sent.current[key]?.saved === saved) delete sent.current[key];
      // Saved: the field shows the task, read again by now. Typed over
      // meanwhile: what was typed since stays to be saved.
      if (ok && same(live.current[key], value)) setDraft(key, null);
      return ok;
    },
    [send, setDraft],
  );

  const commitAll = useCallback(async () => {
    const results = await Promise.all(DRAFT_KEYS.map((key) => commit(key)));
    return results.every(Boolean);
  }, [commit]);

  // A draft left as the screen goes (back with the keyboard up, or a day
  // picked a moment ago) is saved then, as every field saves as it is left.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);
  useEffect(
    () => () => {
      for (const key of DRAFT_KEYS) void commitRef.current(key);
    },
    [],
  );

  const type = useCallback(
    (key: "title" | "description" | "points", text: string) => {
      setFailure(null);
      setDraft(key, text);
    },
    [setDraft],
  );

  const pickDue = useCallback(
    (next: TaskDueDraft) => {
      setFailure(null);
      setDraft("due", next);
      if (dueTimer.current) clearTimeout(dueTimer.current);
      dueTimer.current = setTimeout(() => {
        dueTimer.current = null;
        void commit("due");
      }, DUE_SAVE_DELAY_MS);
    },
    [commit, setDraft],
  );

  const reset = useCallback(() => {
    if (dueTimer.current) clearTimeout(dueTimer.current);
    dueTimer.current = null;
    live.current = NO_DRAFTS;
    setDrafts(NO_DRAFTS);
    setFailure(null);
  }, []);

  const setProof = useCallback(
    (next: TaskProofKind) => void sendNow(proofSave(rowRef.current, next)),
    [sendNow],
  );

  const removePhoto = useCallback(
    (photoId: string) => {
      const task = rowRef.current;
      const paths = referencePhotos(task)
        .filter((photo) => photo.id !== photoId)
        .map((photo) => photo.storage_path);
      void sendNow(photosSave(task, paths));
    },
    [sendNow],
  );

  const addPhotos = useCallback(async () => {
    if (picking || uploading.length > 0) return;
    setFailure(null);
    setPicking(true);
    const kept = referencePhotos(rowRef.current);
    let picked;
    try {
      picked = await pickTaskPhotos(photoRoom(kept.length));
    } finally {
      setPicking(false);
    }
    if (picked.status === "refused") {
      setFailure(picked.reason);
      return;
    }
    if (picked.status !== "picked" || picked.images.length === 0) return;
    const images = picked.images.slice(0, photoRoom(kept.length));
    setUploading(images);
    const up = await uploadTaskPhotos(
      images.map((image) => ({ image })),
      (request) => requestPhotoUrl(request),
      TASK_PHOTO_GATE_COPY.task,
    );
    if (up.status !== "uploaded") {
      setUploading([]);
      setFailure(up.reason);
      return;
    }
    // The task's own as they stand now, then the new ones: a photo removed
    // while these went up stays removed.
    const task = rowRef.current;
    const paths = [
      ...referencePhotos(task).map((photo) => photo.storage_path),
      ...up.paths,
    ];
    await sendNow(photosSave(task, paths));
    setUploading([]);
    // `picked.refused`: some were turned down at the pick (type, size).
    if (picked.refused) setFailure(picked.refused);
  }, [picking, uploading.length, requestPhotoUrl, sendNow]);

  const reassign = useCallback(
    (userId: string, nameOf: (userId: string) => string) => {
      const task = rowRef.current;
      const result = assigneeSave(task, userId);
      if (result.kind !== "save") return;
      if (!reassignRestarts(task)) {
        void sendNow(result);
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
            onPress: () => void sendNow(result),
          },
        ],
      );
    },
    [sendNow],
  );

  return {
    drafts,
    type,
    pickDue,
    commit,
    commitAll,
    reset,
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
