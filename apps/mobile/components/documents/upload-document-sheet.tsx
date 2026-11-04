import { forwardRef, useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  useConfirmDocumentUpload,
  useRequestDocumentUploadUrl,
} from "@repo/hooks";
import { formatBytes } from "@repo/formatting";
import { SignetTokens } from "@repo/theme/signet";
import { DOCUMENT_TITLE_MAX_LENGTH, MAX_UPLOAD_LABEL } from "@repo/validation";
import { FileGlyph } from "@/components/documents/document-glyphs";
import { FilterChips } from "@/components/filter-chips";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetVisit,
} from "@/components/sheet-scaffold";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  pickDocumentPhoto,
  uploadDocumentPhoto,
  type SentUpload,
} from "@/lib/more/document-upload";
import type { DocumentFolder } from "@/lib/more/documents";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s21, the Upload document sheet (`canvas-screens.dc.html` s21, #3399): the
 * picked file's card with Change, a title, the folder chips, and Upload. The
 * wire steps and their refusals live in `lib/more/document-upload.ts`; this
 * file wires them to the board's controls.
 *
 * ## What the board draws that this leaves out
 *
 * - **"Officers only".** `chapter_documents` has no visibility column, so the
 *   toggle would set nothing, and a privacy switch that does nothing is worse
 *   than none.
 * - **"from Files".** Photos only for now: a PDF needs `expo-document-picker`,
 *   a native module, so the card reads "from Photos".
 * - **The "Documents feed ✦ Ask answers" line.** Ask's reach is Ask's to
 *   describe, not an upload sheet's.
 *
 * The board draws no title field. A phone photo's name is `IMG_2041.jpg`, which
 * is a poor title in a chapter library, so the sheet has web's: blank means
 * the file name, as on web.
 *
 * ## Nothing is uploaded until Upload
 *
 * The pick only reads the photo on the device. Mint, PUT and confirm all run on
 * Upload, so a sheet cancelled after a pick leaves no object in the bucket.
 * Once the bytes have landed, a failed confirm keeps their upload, and Upload
 * of the same draft retries the confirm alone rather than sending a second
 * copy (`lib/more/document-upload.ts` § "A confirm that fails keeps the bytes
 * it already sent").
 *
 * ## Closing mid-upload
 *
 * The same rules as s15's edit sheet (`components/profile/edit-profile-sheet.tsx`),
 * through the same `useSheetVisit`: the draft stays until the upload settles, a
 * success closes only the visit it was sent from, and `dismiss()` runs only on
 * a presented sheet.
 */
/** Why the title and folder stopped taking edits after a failed confirm. */
export const RETRY_KEEPS_DRAFT =
  "Trying again keeps this title and folder. Change the photo to start over.";

export const UploadDocumentSheet = forwardRef<
  BottomSheetModal,
  {
    folders: readonly DocumentFolder[];
    /** The folder s12 is filtered to, which the sheet starts on. */
    initialFolder: string | null;
    /** Called once a document is filed, with the title it was filed under. */
    onUploaded?: (title: string) => void;
  }
>(function UploadDocumentSheet({ folders, initialFolder, onUploaded }, ref) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const requestUploadUrl = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();

  const [picked, setPicked] = useState<PickedImage | null>(null);
  const [picking, setPicking] = useState(false);
  const [title, setTitle] = useState("");
  // `undefined` until the member taps a chip: the sheet then follows s12's
  // filter, which can change between visits.
  const [chosenFolder, setChosenFolder] = useState<string | null | undefined>(
    undefined,
  );
  const [titleFocused, setTitleFocused] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** Why the pick was refused (type, size, photo access). */
  const [pickRefusal, setPickRefusal] = useState<string | null>(null);
  /** An upload that failed and may succeed on another try. */
  const [failure, setFailure] = useState<string | null>(null);
  /** A gate only an officer can lift; Upload is withdrawn while it stands. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /**
   * The bytes a failed confirm left in the bucket, with the pick and draft
   * they were sent with, so a retry files them as sent instead of uploading
   * again. Title and folder hold still while they stand, since the retry
   * files the draft they were sent with (`lib/more/document-upload.ts`
   * § "A confirm that fails keeps the bytes it already sent"). A new pick
   * drops them.
   */
  const [stored, setStored] = useState<SentUpload | null>(null);
  const draftHeld = uploading || stored !== null;

  const folder = chosenFolder === undefined ? initialFolder : chosenFolder;
  const canUpload = picked !== null && !uploading && !picking && !refusal;

  const reset = useCallback(() => {
    setPicked(null);
    setTitle("");
    setChosenFolder(undefined);
    setTitleFocused(false);
    setPickRefusal(null);
    setFailure(null);
    setRefusal(null);
    setStored(null);
  }, []);

  const { onAnimate, markClosed, dismiss, visit, isSameVisit } =
    useSheetVisit(ref);
  // Set the moment Upload sends, before `uploading` reaches a render, so two
  // taps in one batch send one upload.
  const sending = useRef(false);
  // Set the moment Choose opens the library, so a second tap before the
  // picker draws doesn't launch another (Android rejects the second launch).
  const pickingNow = useRef(false);

  const closed = () => {
    markClosed();
    if (sending.current) setTitleFocused(false);
    else reset();
  };

  const cancel = () => {
    if (!sending.current) reset();
    dismiss();
  };

  const choose = async () => {
    if (pickingNow.current || sending.current) return;
    pickingNow.current = true;
    setPicking(true);
    setPickRefusal(null);
    try {
      const result = await pickDocumentPhoto();
      if (result.status === "picked") {
        setPicked(result.image);
        setStored(null);
        setFailure(null);
      } else if (result.status === "refused") {
        setPickRefusal(result.reason);
      }
    } finally {
      pickingNow.current = false;
      setPicking(false);
    }
  };

  const upload = async () => {
    if (!picked || !canUpload || sending.current) return;
    sending.current = true;
    setUploading(true);
    setFailure(null);
    const sentFrom = visit();
    const result = await uploadDocumentPhoto(
      picked,
      { title, folder },
      {
        requestUploadUrl: (body) => requestUploadUrl.mutateAsync(body),
        confirm: (body) => confirmUpload.mutateAsync(body),
      },
      stored ?? undefined,
    );
    sending.current = false;
    setUploading(false);
    if (result.status === "uploaded") {
      reset();
      if (isSameVisit(sentFrom)) dismiss();
      onUploaded?.(result.title);
      return;
    }
    if (result.sent) setStored(result.sent);
    if (result.final) setRefusal(result.reason);
    else setFailure(result.reason);
  };

  const sourceLine = picked
    ? `${formatBytes(picked.byteSize)} · from Photos`
    : `JPEG, PNG, GIF or WebP, up to ${MAX_UPLOAD_LABEL}`;

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onAnimate={onAnimate}
      onDismiss={closed}
    >
      <BottomSheetView style={styles.body}>
        <SheetHeader title="Upload document" onCancel={cancel} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            picked ? `Change photo, ${picked.filename}` : "Choose a photo"
          }
          accessibilityHint="Opens your photo library."
          accessibilityState={{ disabled: picking || uploading }}
          disabled={picking || uploading}
          onPress={() => void choose()}
          style={({ pressed }) => [
            styles.fileCard,
            pressed ? styles.pressed : null,
          ]}
        >
          <FileGlyph color={tokens.color.gold.askText} />
          <View style={styles.fileText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {picked ? picked.filename : "Choose a photo"}
            </Text>
            <Text style={styles.fileMeta} numberOfLines={1}>
              {sourceLine}
            </Text>
          </View>
          <Text style={styles.change}>
            {picking ? "Opening…" : picked ? "Change" : "Choose"}
          </Text>
        </Pressable>
        {pickRefusal ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {pickRefusal}
          </Text>
        ) : null}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Title</Text>
          <BottomSheetTextInput
            value={title}
            onChangeText={setTitle}
            editable={!draftHeld}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            placeholder={picked?.filename ?? "Meeting minutes — Aug 14"}
            placeholderTextColor={tokens.color.text.muted}
            accessibilityLabel="Title"
            accessibilityHint={
              stored ? RETRY_KEEPS_DRAFT : "Leave blank to use the file name."
            }
            autoCapitalize="sentences"
            maxLength={DOCUMENT_TITLE_MAX_LENGTH}
            style={[styles.field, titleFocused ? styles.fieldFocused : null]}
          />
        </View>

        {folders.length > 0 ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Folder</Text>
            <FilterChips
              accessibilityLabel="Folder"
              selected={folder}
              onSelect={(value) => {
                if (!draftHeld) setChosenFolder(value);
              }}
              chips={[
                { value: null, label: "None" },
                ...folders.map((entry) => ({
                  value: entry.name,
                  label: entry.name,
                })),
              ]}
            />
          </View>
        ) : null}

        {refusal ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {refusal}
          </Text>
        ) : null}
        {failure ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {failure}
          </Text>
        ) : null}
        {failure && stored ? (
          <Text style={styles.note}>{RETRY_KEEPS_DRAFT}</Text>
        ) : null}

        <SheetPrimaryButton
          label={uploading ? "Uploading…" : "Upload"}
          onPress={() => void upload()}
          disabled={!canUpload}
          accessibilityHint={
            refusal ?? (picked ? undefined : "Choose a photo first.")
          }
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
      gap: tokens.spacing.md,
    },
    fileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      padding: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    pressed: {
      opacity: 0.7,
    },
    fileText: {
      flex: 1,
      gap: 2,
    },
    fileName: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fileMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    change: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.askText,
    },
    fieldGroup: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    // `edit-profile-sheet.tsx`'s field, so the sheets' inputs read as one.
    field: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    fieldFocused: {
      borderColor: tokens.color.gold.house,
    },
    error: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
