import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { DocumentsGlyph } from "@/components/more/more-glyphs";
import { FilterChips } from "@/components/filter-chips";
import { PhotoGlyph } from "@/components/tab-glyphs";
import {
  SheetGrabber,
  SheetHeader,
  SheetPrimaryButton,
  sheetFieldStyles,
  SheetScrim,
  useSheetBackgroundStyle,
  useSheetVisit,
  SheetBackToClose,
  useSheetClose,
  SHEET_STACK_BEHAVIOR,
} from "@/components/sheet-scaffold";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  canPickFiles,
  documentTitle,
  pickDocumentFile,
  pickDocumentPhoto,
  uploadDocumentPhoto,
  type DocumentSource,
  type SentUpload,
} from "@/lib/more/document-upload";
import type { DocumentFolder } from "@/lib/more/documents";
import { useKeptSheetDraft, useKeptSheetOpening } from "@/lib/kept-sheet-draft";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * An upload the sheet has closed on and is still sending, or one that failed:
 * what the screen behind it draws in the sheet's place (s12's pending row,
 * the quick-action bar's notice). `failed` is the reason, a sentence.
 */
export interface PendingDocumentUpload {
  title: string;
  failed: string | null;
}

/** Why the title and folder stopped taking edits after a failed confirm. */
export const RETRY_KEEPS_DRAFT =
  "Trying again keeps this title and folder. Change the file to start over.";

/** The Files row's second line: what it takes, and the cap. */
export const FILES_ROW_META = `PDF, Word, Excel, PowerPoint or text, up to ${MAX_UPLOAD_LABEL}`;

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
 *
 * ## Files and Photos
 *
 * With nothing picked, the card is two rows, Choose a file and Choose a photo,
 * as Slack's and Google Drive's upload menus put them (#3401). Choose a file
 * opens the system picker, which on iOS is Files with iCloud Drive and any
 * cloud app installed (Google Drive among them), and on Android the document
 * picker, which lists Drive too. A picked file's card reads "· from Files" or
 * "· from Photos", and Change goes back to the two rows. A binary without the
 * file picker (a store build from before #3401) draws the photo card alone,
 * as it did before, where Change reopens the library.
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
 * ## The draft outlives a close, not a Cancel
 *
 * The sheets' keep-the-draft rule (`spec/ui/mobile/patterns.md` § Bottom
 * sheets, "A draft outlives a close"): a swipe or scrim close keeps the picked
 * photo, the title and the folder for the next visit, Cancel or an upload that
 * files it gives them up, and Cancel is held while the upload runs, in a visit
 * reopened mid-upload too. What is particular to s21:
 *
 * - A close after a failed confirm keeps the held upload with the draft, so
 *   reopening retries the confirm instead of sending the photo again; a new
 *   pick gives it up. s12 mounts a new sheet per chapter, since the draft
 *   belongs to the chapter it was started in and the held path was minted
 *   under it.
 * - A kept folder is re-read against s12's folders on every visit. One an
 *   officer has since deleted or renamed falls back to what the sheet starts
 *   on with nothing chosen (s12's filter, when that folder still exists, else
 *   None), and a held retry's folder falls back to None, so Upload never
 *   files into a folder no chip shows as selected; the API would otherwise
 *   create it again (`ensureFolder`).
 *
 * ## Upload closes the sheet at once
 *
 * A phone photo takes seconds to send, and a sheet that sits on "Uploading…"
 * for all of them reads as stuck. So Upload closes the sheet the moment it is
 * tapped and reports the upload through `onPending`, for the screen behind it
 * to draw in its place: s12 a quiet row at the top of the list until the
 * document lands in the list's order, the quick-action bar a notice. A success then reports
 * through `onUploaded`; a failure reports the reason through `onPending`, and
 * the draft (with any bytes already sent) stays here for the member to reopen
 * and try again, or Cancel, which drops the pending report too.
 *
 * Through the same `useSheetVisit` as s15's edit sheet
 * (`components/profile/edit-profile-sheet.tsx`): a sheet reopened mid-upload
 * shows the draft held, and `dismiss()` runs only on a presented sheet.
 */
/** What a kept draft holds (`keptDraft`). */
type KeptUpload = {
  picked: PickedImage | null;
  /** Where `picked` came from; `null` with nothing picked. */
  source: DocumentSource | null;
  title: string;
  chosenFolder: string | null | undefined;
  stored: SentUpload | null;
};

export const UploadDocumentSheet = forwardRef<
  BottomSheetModal,
  {
    folders: readonly DocumentFolder[];
    /** The folder s12 is filtered to, which the sheet starts on. */
    initialFolder: string | null;
    /** Called once a document is filed, with the title it was filed under. */
    onUploaded?: (title: string) => void;
    /**
     * The upload this sheet closed on: set when Upload sends, again with the
     * reason if it fails, and `null` once Cancel gives the draft up. A
     * success reports through `onUploaded` instead, and the caller clears
     * its pending state when the filed document is on screen.
     */
    onPending?: (pending: PendingDocumentUpload | null) => void;
    /**
     * Keeps the draft past this sheet's host, under this name (#4593): the
     * Documents screen's sheet goes when the member goes back, and its draft
     * is there the next time they upload from that screen.
     */
    keptDraft?: string;
  }
>(function UploadDocumentSheet(
  { folders, initialFolder, onUploaded, onPending, keptDraft },
  ref,
) {
  const closeSheet = useSheetClose(ref);
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const backgroundStyle = useSheetBackgroundStyle();
  const requestUploadUrl = useRequestDocumentUploadUrl();
  const confirmUpload = useConfirmDocumentUpload();

  // The draft kept from the screen's last visit (`keptDraft`), if any.
  const opening = useKeptSheetOpening<KeptUpload>(keptDraft ?? null);
  const [picked, setPicked] = useState<PickedImage | null>(
    () => opening?.picked ?? null,
  );
  const [source, setSource] = useState<DocumentSource | null>(
    () => opening?.source ?? null,
  );
  // Which row's picker is opening, for its "Opening…"; `null` when none is.
  const [picking, setPicking] = useState<DocumentSource | null>(null);
  // Asked once per mount: a binary either has the module or it doesn't.
  const filesAvailable = useMemo(() => canPickFiles(), []);
  const [title, setTitle] = useState(() => opening?.title ?? "");
  // `undefined` until the member taps a chip: the sheet then follows s12's
  // filter, which can change between visits. Read through `draftFolder`,
  // never directly, since the folder it names may be gone by the next visit.
  const [chosenFolder, setChosenFolder] = useState<string | null | undefined>(
    () => opening?.chosenFolder,
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
  const [stored, setStored] = useState<SentUpload | null>(
    () => opening?.stored ?? null,
  );
  const draftHeld = uploading || stored !== null;
  const kept = useKeptSheetDraft<KeptUpload>(
    keptDraft ?? null,
    { picked, source, title, chosenFolder, stored },
    JSON.stringify([
      picked?.uri ?? null,
      source,
      title,
      chosenFolder ?? null,
      stored?.uploaded ?? null,
    ]),
    opening,
  );

  // A folder the chips can show: None, or one s12 still lists. A kept chip,
  // or s12's filter, can name one an officer deleted or renamed since.
  const listed = (name: string | null) =>
    name === null || folders.some((entry) => entry.name === name);
  const startFolder = listed(initialFolder) ? initialFolder : null;
  const draftFolder =
    chosenFolder !== undefined && listed(chosenFolder)
      ? chosenFolder
      : startFolder;
  // A held retry files into the folder it was sent with, so the chips show
  // that one; a new pick drops the hold and the chips follow the draft again.
  // One deleted or renamed since files at None, where a deleted folder's
  // documents go: sending its old name would have `ensureFolder` create it
  // again when the first confirm never landed. When it did land, the API
  // answers with that row, wherever it now sits, so the folder sent is moot.
  const heldFolder = stored && listed(stored.folder) ? stored.folder : null;
  const folder = stored ? heldFolder : draftFolder;
  const canUpload = picked !== null && !uploading && !picking && !refusal;

  const { clear: clearKept } = kept;
  const reset = useCallback(() => {
    clearKept();
    setPicked(null);
    setSource(null);
    setTitle("");
    setChosenFolder(undefined);
    setTitleFocused(false);
    setPickRefusal(null);
    setFailure(null);
    setRefusal(null);
    setStored(null);
  }, [clearKept]);

  const { onAnimate, markClosed, dismiss } = useSheetVisit(ref);
  // Set the moment Upload sends, before `uploading` reaches a render, so two
  // taps in one batch send one upload.
  const sending = useRef(false);
  // Set from Upload until the upload files or Cancel gives it up: the
  // screen behind holds a pending row for it (`onPending`), so the sheet owes
  // it a `null` on Cancel, and a failure's reason is what that row reopens
  // the sheet to read, so a close keeps it.
  const reported = useRef(false);
  // Set the moment Choose opens the library, so a second tap before the
  // picker draws doesn't launch another (Android rejects the second launch).
  const pickingNow = useRef(false);

  // A swipe or scrim close keeps the draft (see the header), an upload that
  // is in flight, and one a failed confirm left in the bucket: reopening
  // offers the same retry rather than uploading the photo a second time.
  // Cancel is the way to give it up. A refusal is dropped, since the officer
  // may have lifted it by the next visit, and the server will say so again if
  // not. So is a failure with nothing held, because reopening is the member's
  // next try; one with bytes held stays, since it says why the title and
  // folder hold still.
  const closed = () => {
    markClosed();
    setTitleFocused(false);
    // Upload's own close lands while the upload runs, or just after a quick
    // failure; either way the reason stays for the pending row to reopen on.
    if (sending.current || reported.current) return;
    setRefusal(null);
    setPickRefusal(null);
    if (stored === null) setFailure(null);
  };

  // Held while an upload runs (`cancelDisabled` below): the upload can't be
  // called back, so a Cancel then would clear a draft that gets filed anyway,
  // or lose a failure no visit hears of. `sending` covers a tap in the same
  // batch as Upload, before `uploading` reaches a render.
  const cancel = () => {
    if (sending.current) return;
    if (reported.current) {
      reported.current = false;
      onPending?.(null);
    }
    reset();
    dismiss();
  };

  const choose = async (from: DocumentSource) => {
    if (pickingNow.current || sending.current) return;
    pickingNow.current = true;
    setPicking(from);
    setPickRefusal(null);
    try {
      const result =
        from === "files" ? await pickDocumentFile() : await pickDocumentPhoto();
      if (result.status === "picked") {
        setPicked(result.image);
        setSource(from);
        setStored(null);
        setFailure(null);
      } else if (result.status === "refused") {
        setPickRefusal(result.reason);
      }
    } finally {
      pickingNow.current = false;
      setPicking(null);
    }
  };

  // Change with both sources: back to the two rows, the pick given up as a
  // new pick would give it up, bytes held for a retry included. Nothing has
  // been sent for it but those, so nothing else is lost.
  const change = () => {
    if (uploading || pickingNow.current || sending.current) return;
    setPicked(null);
    setSource(null);
    setStored(null);
    setFailure(null);
    setPickRefusal(null);
  };

  const upload = async () => {
    if (!picked || !canUpload || sending.current) return;
    sending.current = true;
    setUploading(true);
    setFailure(null);
    setRefusal(null);
    // Out of the kept store until it files or fails, so the screen reopened
    // mid-upload can't send it twice.
    kept.hold();
    // The title it will be filed under, for the pending row: a retry files
    // the one it was first sent with.
    const filedAs = stored ? stored.title : documentTitle(title, picked);
    reported.current = true;
    onPending?.({ title: filedAs, failed: null });
    setTitleFocused(false);
    dismiss();
    const result = await uploadDocumentPhoto(
      picked,
      { title, folder },
      {
        requestUploadUrl: (body) => requestUploadUrl.mutateAsync(body),
        confirm: (body) => confirmUpload.mutateAsync(body),
      },
      stored ? { ...stored, folder: heldFolder } : undefined,
    );
    sending.current = false;
    setUploading(false);
    if (result.status === "uploaded") {
      reported.current = false;
      reset();
      onUploaded?.(result.title);
      return;
    }
    if (result.sent) setStored(result.sent);
    // With the bytes it left, which this render hasn't drawn yet: a sheet
    // that has gone keeps them for the next visit's retry.
    kept.release(result.sent ? { stored: result.sent } : undefined);
    // Kept for the visit the pending row reopens, which is how the member
    // hears of it: the sheet closed when Upload was tapped.
    if (result.final) setRefusal(result.reason);
    else setFailure(result.reason);
    onPending?.({ title: filedAs, failed: result.reason });
  };

  const sourceLine = picked
    ? `${formatBytes(picked.byteSize)} · from ${
        source === "files" ? "Files" : "Photos"
      }`
    : `JPEG, PNG, GIF or WebP, up to ${MAX_UPLOAD_LABEL}`;
  const pickDisabled = picking !== null || uploading;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      keyboardBehavior="interactive"
      backgroundStyle={backgroundStyle}
      backdropComponent={SheetScrim}
      handleComponent={SheetGrabber}
      onAnimate={onAnimate}
      onDismiss={closed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader
          title="Upload document"
          onCancel={cancel}
          cancelDisabled={uploading}
        />

        {picked || !filesAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              picked
                ? `Change ${filesAvailable ? "file" : "photo"}, ${picked.filename}`
                : "Choose a photo"
            }
            accessibilityHint={
              filesAvailable
                ? "Goes back to choosing a file or a photo."
                : "Opens your photo library."
            }
            accessibilityState={{ disabled: pickDisabled }}
            disabled={pickDisabled}
            onPress={() => (filesAvailable ? change() : void choose("photos"))}
            style={({ pressed }) => [
              styles.fileCard,
              pressed ? styles.pressed : null,
            ]}
          >
            {filesAvailable && source === "photos" ? (
              <PhotoGlyph
                focused={false}
                accent={accent}
                muted={tokens.color.text.mutedForeground}
              />
            ) : (
              <DocumentsGlyph
                color={tokens.color.text.mutedForeground}
                size={24}
              />
            )}
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
        ) : (
          <View style={styles.sourceCard}>
            <SourceRow
              label="Choose a file"
              meta={FILES_ROW_META}
              hint="Opens Files, where iCloud Drive and Google Drive are too."
              opening={picking === "files"}
              disabled={pickDisabled}
              onPress={() => void choose("files")}
              styles={styles}
              glyph={
                <DocumentsGlyph
                  color={tokens.color.text.mutedForeground}
                  size={24}
                />
              }
            />
            <View style={styles.sourceDivider} />
            <SourceRow
              label="Choose a photo"
              meta="From your photo library"
              hint="Opens your photo library."
              opening={picking === "photos"}
              disabled={pickDisabled}
              onPress={() => void choose("photos")}
              styles={styles}
              glyph={
                <PhotoGlyph
                  focused={false}
                  accent={accent}
                  muted={tokens.color.text.mutedForeground}
                />
              }
            />
          </View>
        )}
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
        {stored ? (
          // Also on a visit opened on a kept draft, whose failure went with
          // the last screen: it says why title and folder hold still.
          <Text style={styles.note}>{RETRY_KEEPS_DRAFT}</Text>
        ) : null}

        <SheetPrimaryButton
          label={uploading ? "Uploading…" : "Upload"}
          onPress={() => void upload()}
          disabled={!canUpload}
          accessibilityHint={
            refusal ??
            (picked
              ? undefined
              : filesAvailable
                ? "Choose a file or a photo first."
                : "Choose a photo first.")
          }
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
});

/** One of the two rows the card shows with nothing picked. */
function SourceRow({
  label,
  meta,
  hint,
  glyph,
  opening,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  meta: string;
  hint: string;
  glyph: ReactNode;
  opening: boolean;
  disabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceRow,
        pressed ? styles.pressed : null,
      ]}
    >
      {glyph}
      <View style={styles.fileText}>
        <Text style={styles.fileName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.fileMeta} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <Text style={styles.change}>{opening ? "Opening…" : "Choose"}</Text>
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  const fieldStyles = sheetFieldStyles(tokens, accent);
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
    sourceCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      overflow: "hidden",
    },
    sourceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      padding: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    sourceDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.color.border.hairline,
      marginLeft: tokens.spacing.md + 24 + tokens.spacing.md,
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
      color: accent,
    },
    fieldGroup: {
      gap: tokens.spacing.xs,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    field: fieldStyles.field,
    fieldFocused: fieldStyles.fieldFocused,
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
