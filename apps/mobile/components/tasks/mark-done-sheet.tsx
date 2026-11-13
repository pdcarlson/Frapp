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
 * itself on mount and calls `onClosed` once it has gone.
 */
export function MarkDoneSheet({
  task,
  initialProblem = null,
  onComplete,
  onClosed,
}: {
  task: MarkDoneSheetTask;
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

  const [photos, setPhotos] = useState<PendingTaskPhoto[]>([]);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
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
          onCancel={() => dismiss()}
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
