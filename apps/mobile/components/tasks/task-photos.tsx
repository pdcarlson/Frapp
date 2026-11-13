import { useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTaskPhotoUrl, type LiveTaskPhoto } from "@repo/hooks";
import { TASK_PHOTOS_MAX, proofLinkDomain } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { CloseGlyph, LinkGlyph } from "@/components/control-glyphs";
import { IconButton } from "@/components/icon-button";
import { CameraGlyph } from "@/components/service-hours/camera-glyph";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import { openMessageLink } from "@/lib/chat/open-link";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * Task photos and proof on the phone (#4565, #4635; `spec/behavior/tasks.md`
 * § Photos): web's `apps/web/components/tasks/task-photo.tsx` in native
 * parts, with its words. A stored photo is read through a short-lived signed
 * link (`useTaskPhotoUrl`), a row of them opens a swipeable full-screen
 * viewer, the way Google Photos and an Asana attachment preview page through
 * a set, and a proof link is a chip showing its domain.
 */

/** One stored photo, or a quiet box while its link loads. */
function StoredTaskPhoto({
  taskId,
  photoId,
  style,
  contain = false,
}: {
  taskId: string;
  photoId: string;
  style: object;
  contain?: boolean;
}) {
  const url = useTaskPhotoUrl(taskId, photoId);
  const { tokens } = useFrappTheme();
  if (!url.data) {
    return (
      <View
        style={[style, { backgroundColor: tokens.color.surface.surface1 }]}
      />
    );
  }
  return (
    <Image
      source={{ uri: url.data }}
      style={style}
      resizeMode={contain ? "contain" : "cover"}
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * The full-screen viewer over a set of photos: a horizontal paging list, one
 * photo per screen width, swiped between, with "Photo 2 of 4" and a close.
 */
export function TaskPhotoViewer({
  taskId,
  photos,
  index,
  label,
  onClose,
}: {
  taskId: string;
  photos: readonly LiveTaskPhoto[];
  /** The photo it opens on, or `null` while it is closed. */
  index: number | null;
  /** What the photos are ("Photos", "Proof"). */
  label: string;
  onClose: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { width } = useWindowDimensions();
  const [at, setAt] = useState(index ?? 0);
  const [openedOn, setOpenedOn] = useState(index);
  // A new open starts on the photo it was opened on.
  if (index !== openedOn) {
    setOpenedOn(index);
    if (index !== null) setAt(index);
  }
  const open = index !== null && photos.length > 0;
  return (
    <Modal
      visible={open}
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={["portrait", "landscape"]}
    >
      <SafeAreaView style={styles.viewer}>
        <View style={styles.viewerHead}>
          <Text style={styles.viewerTitle} accessibilityRole="header">
            {photos.length > 1
              ? `${label} · Photo ${at + 1} of ${photos.length}`
              : label}
          </Text>
          <IconButton label="Close" onPress={onClose}>
            <CloseGlyph color={tokens.color.text.foreground} />
          </IconButton>
        </View>
        {open ? (
          <FlatList
            data={photos as LiveTaskPhoto[]}
            keyExtractor={(photo: LiveTaskPhoto) => photo.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index ?? 0, photos.length - 1)}
            getItemLayout={(_data: unknown, i: number) => ({
              length: width,
              offset: width * i,
              index: i,
            })}
            onMomentumScrollEnd={(event: {
              nativeEvent: { contentOffset: { x: number } };
            }) =>
              setAt(
                Math.round(event.nativeEvent.contentOffset.x / (width || 1)),
              )
            }
            renderItem={({ item }: { item: LiveTaskPhoto }) => (
              <View style={[styles.page, { width }]}>
                <StoredTaskPhoto
                  taskId={taskId}
                  photoId={item.id}
                  style={styles.full}
                  contain
                />
              </View>
            )}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

/**
 * A row of a task's photos as thumbnails under a caption, each opening the
 * viewer on itself. Nothing when there are none.
 */
export function TaskPhotoStrip({
  taskId,
  photos,
  label,
}: {
  taskId: string;
  photos: readonly LiveTaskPhoto[];
  label: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <View style={styles.strip}>
      <Text style={styles.caption}>{label}</Text>
      <View style={styles.thumbs}>
        {photos.map((photo, i) => (
          <Pressable
            key={photo.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label}, photo ${i + 1} of ${photos.length}, opens full size`}
            onPress={() => setOpen(i)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <StoredTaskPhoto
              taskId={taskId}
              photoId={photo.id}
              style={styles.thumb}
            />
          </Pressable>
        ))}
      </View>
      <TaskPhotoViewer
        taskId={taskId}
        photos={photos}
        index={open}
        label={label}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

/** A proof link as a chip showing its domain; opens in the in-app browser. */
export function ProofLinkChip({ link }: { link: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const domain = proofLinkDomain(link);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Proof link: ${domain}, opens in the browser`}
      onPress={() => void openMessageLink(link)}
      style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
    >
      <LinkGlyph color={tokens.color.text.mutedForeground} size={14} />
      <Text style={styles.chipText} numberOfLines={1}>
        {domain}
      </Text>
    </Pressable>
  );
}

/** The task fields the proof block reads. */
export interface TaskProofView {
  id: string;
  photos: readonly LiveTaskPhoto[];
  proofLink: string | null;
  sentBackReason: string | null;
  completionNote: string | null;
}

/**
 * What a task shows of its photos and proof (#4635), as web's `TaskProof`
 * does: the reference photos; then, to the assignee and officers, why it was
 * sent back, the proof photos or link, and the assignee's reply. On a waiting
 * task it sits above Confirm and Send back, so the officer sees the proof
 * first.
 */
export function TaskProof({
  task,
  showProof,
  sentBack,
}: {
  task: TaskProofView;
  /** The proof is the officer's to see before confirming, and the assignee's. */
  showProof: boolean;
  /** It waits on its assignee after a send-back (Needs changes). */
  sentBack: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const reference = task.photos.filter((photo) => photo.kind === "reference");
  const proof = showProof
    ? task.photos.filter((photo) => photo.kind === "proof")
    : [];
  const link = showProof ? task.proofLink : null;
  const note = showProof ? task.completionNote : null;
  // The reason shows while the task waits on the change, and beside the
  // reply once it is marked done again.
  const reason = showProof && (sentBack || note) ? task.sentBackReason : null;
  if (
    reference.length === 0 &&
    proof.length === 0 &&
    !link &&
    !reason &&
    !note
  ) {
    return null;
  }
  return (
    <View style={styles.proof}>
      {reason ? <SentBackNote reason={reason} /> : null}
      <TaskPhotoStrip taskId={task.id} photos={reference} label="Photos" />
      <TaskPhotoStrip taskId={task.id} photos={proof} label="Proof" />
      {link ? <ProofLinkChip link={link} /> : null}
      {note ? (
        <Text style={styles.line}>
          <Text style={styles.lineLead}>Reply: </Text>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** "Sent back: Floor is still sticky", on a warning tint. */
export function SentBackNote({ reason }: { reason: string }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <View style={styles.sentBack}>
      <Text style={styles.line}>
        <Text style={styles.lineLead}>Sent back: </Text>
        {reason}
      </Text>
    </View>
  );
}

/**
 * Photos being chosen on a form: the task's own stored ones (an edit) and
 * newly picked ones, each a thumbnail with a remove ×, and Add photos while
 * there is room under `TASK_PHOTOS_MAX`.
 */
export function TaskPhotoPicker({
  taskId,
  kept = [],
  picked,
  onRemoveKept,
  onRemovePicked,
  onAdd,
  disabled = false,
  adding = false,
  addLabel = "Add photos",
}: {
  taskId?: string;
  kept?: readonly LiveTaskPhoto[];
  picked: readonly PickedImage[];
  onRemoveKept?: (photoId: string) => void;
  onRemovePicked: (index: number) => void;
  onAdd: () => void;
  disabled?: boolean;
  /** The library is opening. */
  adding?: boolean;
  addLabel?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const room = TASK_PHOTOS_MAX - kept.length - picked.length;
  const glyph = disabled ? tokens.color.text.disabled : tokens.color.text.muted;
  return (
    <View style={styles.thumbs}>
      {taskId
        ? kept.map((photo, i) => (
            <View key={photo.id} style={styles.tile}>
              <StoredTaskPhoto
                taskId={taskId}
                photoId={photo.id}
                style={styles.tileImage}
              />
              <View style={styles.remove}>
                <IconButton
                  label={`Remove photo ${i + 1}`}
                  disabled={disabled}
                  onPress={() => onRemoveKept?.(photo.id)}
                >
                  <CloseGlyph color={glyph} size={14} />
                </IconButton>
              </View>
            </View>
          ))
        : null}
      {picked.map((image, i) => (
        <View key={`${image.uri}-${i}`} style={styles.tile}>
          <Image
            source={{ uri: image.uri }}
            style={styles.tileImage}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.remove}>
            <IconButton
              label={`Remove ${image.filename}`}
              disabled={disabled}
              onPress={() => onRemovePicked(i)}
            >
              <CloseGlyph color={glyph} size={14} />
            </IconButton>
          </View>
        </View>
      ))}
      {room > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          accessibilityHint={`Opens your photo library. Up to ${room} more.`}
          accessibilityState={{ disabled: disabled || adding }}
          disabled={disabled || adding}
          onPress={onAdd}
          style={({ pressed }) => [styles.add, pressed ? styles.pressed : null]}
        >
          <CameraGlyph color={tokens.color.text.mutedForeground} />
          <Text style={styles.addLabel}>{adding ? "Opening…" : addLabel}</Text>
        </Pressable>
      ) : (
        <Text style={styles.caption}>
          {TASK_PHOTOS_MAX} photos is the most.
        </Text>
      )}
    </View>
  );
}

const THUMB = 56;
const TILE = 64;

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    proof: {
      gap: tokens.spacing.sm,
    },
    strip: {
      gap: tokens.spacing.xs,
    },
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    thumbs: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    thumb: {
      width: THUMB,
      height: THUMB,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    pressed: {
      opacity: 0.85,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      maxWidth: "100%",
      gap: tokens.spacing.xs,
      minHeight: 32,
      paddingHorizontal: tokens.spacing.sm,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    chipText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
      flexShrink: 1,
    },
    line: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.foreground,
    },
    lineLead: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    sentBack: {
      borderRadius: tokens.radius.control,
      backgroundColor: tint(tokens.color.semantic.warning, 0.13),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    tile: {
      width: TILE,
      height: TILE,
    },
    tileImage: {
      width: TILE,
      height: TILE,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
    },
    remove: {
      position: "absolute",
      top: 2,
      right: 2,
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
    add: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: tint(tokens.color.text.foreground, 0.2),
      backgroundColor: tokens.color.surface.surface1,
    },
    addLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    viewer: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    viewerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
    },
    viewerTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    page: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    full: {
      width: "100%",
      height: "100%",
    },
  });
}
