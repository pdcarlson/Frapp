import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { errorCopy } from "@repo/hooks/error-copy";
import { TASK_ACTION_LABELS, useRequestTaskPhotoUploadUrl } from "@repo/hooks";
import {
  TASK_COMPLETION_NOTE_MAX,
  TASK_PROOF_LINK_MAX,
  taskMarkDoneCheck,
  type TaskProofKind,
} from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  sheetFieldStyles,
  useSheetBackgroundStyle,
  useSheetClose,
  useSheetVisit,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import { SentBackNote, TaskPhotoPicker } from "@/components/tasks/task-photos";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  useDropKeptSheetDraft,
  useKeptSheetDraft,
  useKeptSheetOpening,
} from "@/lib/kept-sheet-draft";
import {
  photoRoom,
  pickTaskPhotos,
  uploadTaskPhotos,
  TASK_PHOTO_GATE_COPY,
  type PendingTaskPhoto,
} from "@/lib/tasks/task-photos";
import {
  taskProofRefusal,
  taskStatusGateRefusal,
} from "@/lib/tasks/status-refusal";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** What Mark done sends besides the status (#4635). */
export interface CompletionProof {
  proof_photo_paths?: string[];
  proof_link?: string;
  completion_note?: string;
}

/** The task the sheet marks done. */
export interface MarkDoneSheetTask {
  id: string;
  title: string;
  proofKind: TaskProofKind;
  /** It waits on its assignee after a send-back (Needs changes). */
  sentBack: boolean;
  sentBackReason: string | null;
  /**
   * It is done already (marked on another device, say): Mark done says so
   * before it uploads anything. Omitted reads as not done.
   */
  done?: boolean;
  /**
   * When it was last sent back (`sent_back_at`), or null before any
   * send-back: which round of Mark done this is. A kept draft from another
   * round (done somewhere else, then sent back) doesn't come back.
   */
  sentBackAt?: string | null;
}

/**
 * What Mark done keeps past its screen (#5041): the photos as picked (never a
 * path from an upload, which a refused save or the orphan sweep can have
 * made stale, so a later visit uploads them again), the link, and the reply.
 */
interface KeptMarkDone {
  photos: PendingTaskPhoto[];
  link: string;
  note: string;
  /**
   * The task's proof kind and round as it was typed for. A draft whose kind
   * has changed since would put proof in a field the sheet no longer draws;
   * one from an earlier round answers a send-back that has been answered.
   */
  proofKind: TaskProofKind;
  round: string | null;
}

/** What the sheet says when the task was marked done somewhere else. */
export const MARK_DONE_ALREADY_DONE = "This task is already marked done.";

/**
 * Mark done with proof on the phone (#4565, #4635), web's Mark done dialog
 * (`MarkDoneControl` in `apps/web/components/tasks/task-photo.tsx`) as a
 * sheet: the photos or the link the task asks for and, after a send-back, the
 * officer's reason and "Reply to the officer", the way Canvas and Google
 * Classroom take a resubmission and S'moresUp a chore's photo proof.
 *
 * It checks what the server checks before it sends (`taskMarkDoneCheck`), then
 * uploads the photos and hands their paths to `onComplete`, which makes the
 * status write; a refusal from it is put in words here and the sheet stays,
 * keeping what was added. Photos go up only on Mark done, so a sheet given
 * up before then leaves nothing in the bucket (one given up after a refused
 * write leaves its uploads for the orphan sweep). Once up, they are sent
 * again on a retry, unless the refusal dropped them: anything but a gate's
 * or one for want of proof, such as "This task changed…", which deletes the
 * photos it was sent, uploads anew.
 *
 * The host mounts one per Mark done (`key` on the task), and the sheet opens
 * itself on mount and calls `onClosed` once it has gone. With `keptDraft`
 * (`mark-done:<taskId>`, #5041) what was added outlives that: a swipe, the
 * back gesture or leaving the screen keeps it for the task's next Mark done,
 * from any host. Cancel and a Mark done that lands give it up; one in flight
 * holds it out, and one that fails puts it back.
 */
export function MarkDoneSheet({
  task,
  initialProblem = null,
  keptDraft,
  onComplete,
  onClosed,
}: {
  task: MarkDoneSheetTask;
  /** The kept draft's name, `mark-done:<taskId>`; omitted keeps nothing. */
  keptDraft?: string;
  /** Why it opened, when a direct Mark done was refused for want of proof. */
  initialProblem?: string | null;
  /** Makes the status write. Rejects with the server's error. */
  onComplete: (proof: CompletionProof) => Promise<void>;
  onClosed: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const ref = useRef<BottomSheetModal>(null);
  const closeSheet = useSheetClose(ref);
  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  const requestUploadUrl = useRequestTaskPhotoUploadUrl();

  // Done somewhere else: nothing is left to send it with, so it keeps
  // nothing and the kept draft goes.
  const keptName = task.done ? null : (keptDraft ?? null);
  const round = task.sentBackAt ?? null;
  const stored = useKeptSheetOpening<KeptMarkDone>(keptName);
  const fits =
    stored !== undefined &&
    stored.proofKind === task.proofKind &&
    stored.round === round;
  const opening = fits ? stored : undefined;
  // Done somewhere else, or kept for another round or proof kind: it goes.
  useDropKeptSheetDraft(
    keptDraft ?? null,
    task.done === true || (stored !== undefined && !fits),
  );
  const [photos, setPhotos] = useState<PendingTaskPhoto[]>(
    () => opening?.photos.slice(0, photoRoom(0)) ?? [],
  );
  const [link, setLink] = useState(opening?.link ?? "");
  const [note, setNote] = useState(opening?.note ?? "");
  const kept = useKeptSheetDraft<KeptMarkDone>(
    keptName,
    {
      photos: photos.map(({ image }) => ({ image })),
      link,
      note,
      proofKind: task.proofKind,
      round,
    },
    undefined,
    opening,
  );
  const [problem, setProblem] = useState<string | null>(initialProblem);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Set before the first await, so two taps in one frame send once.
  const sending = useRef(false);
  const picking = useRef(false);

  useEffect(() => {
    ref.current?.present();
  }, []);

  const kind = task.proofKind;

  const addPhotos = async () => {
    if (picking.current || sending.current) return;
    picking.current = true;
    setAdding(true);
    try {
      const result = await pickTaskPhotos(photoRoom(photos.length));
      if (result.status === "picked") {
        setPhotos((current) => [
          ...current,
          ...result.images
            .slice(0, photoRoom(current.length))
            .map((image) => ({ image })),
        ]);
        setProblem(result.refused);
      } else if (result.status === "refused") {
        setProblem(result.reason);
      }
    } finally {
      picking.current = false;
      setAdding(false);
    }
  };

  const submit = async () => {
    if (sending.current) return;
    if (task.done) {
      setProblem(MARK_DONE_ALREADY_DONE);
      return;
    }
    const checked = taskMarkDoneCheck(
      { proofKind: kind, sentBack: task.sentBack },
      { photoCount: photos.length, link, note },
    );
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    sending.current = true;
    setBusy(true);
    setProblem(null);
    const sentFrom = visit();
    // Out of the kept store until it lands or fails, so the task's Mark done
    // reopened mid-send doesn't offer the same proof again.
    kept.hold();
    try {
      let paths: string[] = [];
      if (photos.length > 0) {
        const up = await uploadTaskPhotos(
          photos,
          (body) => requestUploadUrl.mutateAsync(body),
          TASK_PHOTO_GATE_COPY.proof,
        );
        setPhotos(up.photos);
        if (up.status !== "uploaded") {
          kept.release();
          setProblem(up.reason);
          return;
        }
        paths = up.paths;
      }
      try {
        await onComplete({
          ...(paths.length > 0 ? { proof_photo_paths: paths } : {}),
          ...(checked.proof.proofLink
            ? { proof_link: checked.proof.proofLink }
            : {}),
          ...(checked.proof.completionNote
            ? { completion_note: checked.proof.completionNote }
            : {}),
        });
      } catch (error) {
        kept.release();
        if (!isSameVisit(sentFrom)) return;
        // A path the server turned down can't win again: upload anew next time.
        if (!taskProofRefusal(error) && !taskStatusGateRefusal(error)) {
          setPhotos((current) => current.map(({ image }) => ({ image })));
        }
        setProblem(
          taskStatusGateRefusal(error) ??
            taskProofRefusal(error) ??
            errorCopy(error, "Couldn't mark the task done. Try again.", {
              serverWritesForMembers: true,
            }),
        );
        return;
      }
      kept.clear();
      if (isSameVisit(sentFrom)) dismiss();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onAnimate={onAnimate}
      onDismiss={() => {
        markClosed();
        onClosed();
      }}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetScrollView
        onAccessibilityEscape={closeSheet}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <SheetHeader
          title={TASK_ACTION_LABELS.complete}
          onCancel={() => {
            // Held while a send runs: Cancel can't call the write back, and
            // giving the draft up here would lose it if the write fails.
            if (sending.current) return;
            kept.clear();
            dismiss();
          }}
          cancelDisabled={busy}
        />
        <Text style={styles.subtitle} numberOfLines={2}>
          {task.title}
        </Text>

        {task.sentBack && task.sentBackReason ? (
          <SentBackNote reason={task.sentBackReason} />
        ) : null}

        {kind !== "link" ? (
          <View style={styles.group}>
            <Text style={styles.label}>
              {kind === "photo"
                ? "Photos of the finished job"
                : "Photos (optional)"}
            </Text>
            <TaskPhotoPicker
              picked={photos.map(({ image }) => image)}
              onRemovePicked={(index) =>
                setPhotos((current) => current.filter((_, i) => i !== index))
              }
              onAdd={() => void addPhotos()}
              disabled={busy}
              adding={adding}
            />
          </View>
        ) : (
          <View style={styles.group}>
            <Text style={styles.label}>Link</Text>
            <BottomSheetTextInput
              value={link}
              onChangeText={setLink}
              editable={!busy}
              placeholder="https://"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Link"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={TASK_PROOF_LINK_MAX}
              style={styles.field}
            />
          </View>
        )}

        {task.sentBack ? (
          <View style={styles.group}>
            <Text style={styles.label}>Reply to the officer</Text>
            <BottomSheetTextInput
              value={note}
              onChangeText={setNote}
              editable={!busy}
              placeholder="What you changed"
              placeholderTextColor={tokens.color.text.muted}
              accessibilityLabel="Reply to the officer"
              multiline
              maxLength={TASK_COMPLETION_NOTE_MAX}
              style={[styles.field, styles.multiline]}
            />
          </View>
        ) : null}

        {problem ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {problem}
          </Text>
        ) : null}

        <SheetPrimaryButton
          label={TASK_ACTION_LABELS.complete}
          onPress={() => void submit()}
          disabled={busy}
          busy={busy}
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fields = sheetFieldStyles(tokens, accent);
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    subtitle: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    group: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    field: fields.field,
    multiline: {
      ...fields.fieldMultilineText,
      minHeight: 72,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructiveText,
    },
  });
}
