import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  useActiveChapterId,
  useDeleteDocument,
  useDocumentDownloadUrl,
  useDocumentFolders,
  useDocumentLibrary,
  useMarkFilterHold,
  useDocuments,
  useDocumentStars,
  useMemberDisplayNames,
  useSetDocumentPin,
  useSetDocumentStar,
  usePermissionList,
  useSemesters,
} from "@repo/hooks";
import {
  DELETE_DOCUMENT_BODY,
  DELETE_DOCUMENT_LABEL,
  SORT_OPTIONS,
  deleteDocumentTitle,
  isActiveDateFilter,
  isDriveCopy,
  limitedDocumentCheck,
  markedItems,
  NO_MARK_FILTER,
  tierRows,
  type DocumentMarkFilter,
  type DocumentSort,
  type FileKind,
} from "@repo/hooks/document-library";
import {
  buildFolderTree,
  folderLevel,
  folderPlace,
  liftMarkedFolders,
  type FolderTreeNode,
} from "@repo/hooks/document-folder-tree";
import { describeLoadFailure, errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { BACK_TO_YOU } from "@/components/back-row";
import {
  UploadDocumentSheet,
  type PendingDocumentUpload,
} from "@/components/documents/upload-document-sheet";
import {
  Chip,
  ChipRow,
  FilterChips,
  MenuChip,
  SearchField,
  type FilterChip,
} from "@/components/filter-chips";
import {
  DocumentActionsSheet,
  type DocumentActionsTarget,
} from "@/components/documents/document-actions-sheet";
import { PinGlyph, StarGlyph } from "@/components/documents/document-glyphs";
import {
  LIMITED_LABEL,
  LimitedMark,
} from "@/components/documents/limited-mark";
import { MarkedCards } from "@/components/documents/marked-cards";
import { DocumentTiles } from "@/components/documents/document-tiles";
import { ListLayoutToggle } from "@/components/list-layout-toggle";
import {
  BackGlyph,
  DisclosureGlyph,
  ForwardGlyph,
} from "@/components/control-glyphs";
import { OptionSheet } from "@/components/option-sheet";
import { useListLayout } from "@/lib/list-layout";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import {
  documentMeta,
  selectDocumentFolders,
  selectDocuments,
} from "@/lib/more/documents";
import { shareDocumentFile } from "@/lib/more/document-file";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s12 — Documents (`canvas-screens.dc.html:427`).
 *
 * ## No `NoChapterState` here, unlike its siblings
 *
 * `useDocuments` and `useDocumentFolders` are deliberately not gated on a
 * resolved `chapterId`: the route resolves the chapter from the request header,
 * and `ChapterGuard` auto-resolves a single-membership member server-side. So a
 * member with one chapter gets their real library even when the mobile client
 * has no `active_chapter_id` claim to read (no membership on the token yet,
 * or a hook-off incident — #805 itself is closed). Rendering "no chapter
 * selected" over that would contradict the folder chips sitting above it, and
 * point at a picker that would not change the outcome. A member who genuinely
 * has no resolvable chapter gets a `400` instead, which the error state covers.
 *
 * ## Pinned and starred (#3934)
 *
 * Canvas draws PINNED above the list. An officer's pin is `pinned_at` on a
 * folder or a document, and each member's stars come from
 * `GET /v1/documents/stars` (`spec/behavior/chapter-docs.md` § Pinned and
 * starred). On All with no search or filter, PINNED and then STARRED cards
 * (`components/documents/marked-cards.tsx`) sit above the list, folders and
 * files together, as web's cards do. Anywhere else the same tiers lead the
 * list. The folder chips run pinned, then starred, then the rest, each
 * wearing its pin or star. A long press on a chip, a card or a row opens the
 * actions sheet (`components/documents/document-actions-sheet.tsx`): Star for
 * everyone, Pin for the chapter for `chapter_docs:manage`.
 *
 * ## Upload, for whoever may
 *
 * The floating create button (Upload document) opens the s21 sheet
 * (`components/documents/upload-document-sheet.tsx`, #3399). Canvas draws an
 * upload glyph at the far end of the `‹ More` row; it moved to the thumb's
 * reach on 2026-11-05 (`spec/ui/mobile/patterns.md` § Create actions). It is
 * drawn only for a viewer who holds `chapter_docs:upload`, the permission both
 * upload routes carry, as web's `<Can permission="chapter_docs:upload">` does:
 * by default that is the President alone (`DEFAULT_SYSTEM_ROLES`), so most
 * members never see a control the server would refuse them. `can` reads the
 * owner's `*` the way the server's guard does. While the permission read is
 * loading the button is absent, which fails closed.
 *
 * s21 takes a file from Files (PDF, Office, text) or a photo, in a store build
 * that has `expo-document-picker` (#3401), and a photo alone in one before it.
 *
 * ## Search, filters and sort, as web's (#3938)
 *
 * The screen reads the chapter's whole library once (`GET /v1/documents`
 * with no `search` or `folder`) and runs web's library logic over it
 * (`@repo/hooks/document-library`, the module `/documents` imports): the
 * folder chip, then a typo-tolerant search over title, description,
 * uploader, folder and type, the Uploaded by and Date added filters, and the
 * order, Name A–Z by default as on web. A File type filter (PDF, Word,
 * Slides, Spreadsheet, Image, Other) reads each file's declared type or its
 * stored extension, and search finds those words too. Pinned and Starred
 * toggles (#4290) keep marked files, either when both are on. All of it is local, so a keystroke or
 * a chip re-ranks what is in hand, offline too. Web's custom date range is
 * not offered: a phone date picker is a native module that waits for a store
 * build.
 *
 * Each filter is its own chip in one row under the folders (#5278, Paul
 * 2026-11-17: "sort and filter on mobile, it just sucks"), as Google Drive's
 * Type, People and Modified chips are on a phone: Type, Uploaded by and Date
 * added each open their choices in a sheet (`OptionSheet`) and name the pick
 * once set; Starred and Pinned toggle in place; Clear leads the row while
 * anything is set. The order is across from the count over the list ("Name
 * A–Z ⌄"), as Files, Drive and Dropbox put theirs, and opens its own sheet.
 * Until then all of it sat behind a "Sort & filter" chip at the far end of the
 * folder row, opening a panel of five chip rows.
 *
 * ## Delete, for whoever may
 *
 * A viewer holding `chapter_docs:manage` (the guard on `DELETE
 * /v1/documents/{id}`) deletes a document from its row's actions sheet (a
 * long press, or the row's named screen-reader action; Star and Pin share
 * the sheet since #3934), then confirms in a system alert, as Invited's
 * Revoke and chat's channel actions do. The row shows
 * its spinner while the request runs and takes no second press.
 *
 * ## Opening a document
 *
 * A tap downloads the file and hands it to the system share sheet, where the
 * member saves it to Files or opens it in an app that reads it (#4409,
 * `lib/more/document-file.ts`). It used to open the inline `downloadUrl` in
 * the in-app browser, the one place a member's upload was served as a page.
 * The row's spinner runs from the tap until the sheet closes, and a file that
 * lands after the member has left s12 presents nothing.
 *
 * There is no separate download endpoint: `GET /v1/documents/{id}` returns the
 * document with a freshly signed `downloadUrl`. That read runs through a
 * *mutation* (`useDocumentDownloadUrl`) rather than a query, so a tap that
 * failed once reaches the network again on the next tap instead of replaying a
 * cached error — and the expiring URL never enters the cache. Note the key is
 * **`downloadUrl`**: there is no case-transforming interceptor anywhere in the
 * stack, and reading `download_url` is what left the two web call sites opening
 * `undefined` until #1040. `selectDownloadUrl` (`@repo/hooks`) accepts both
 * spellings and is the only place either appears *for a document download*.
 * Chat attachments are a different endpoint whose key genuinely is
 * `download_url` — do not converge them.
 */
export default function DocumentsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  // List or Grid (#4175), kept on this phone, its switch on the title row.
  const layout = useListLayout("documents");
  const [openFailed, setOpenFailed] = useState(false);
  // The upload the sheet closed on, drawn as the list's first row until the
  // filed document arrives in the list's order (`UploadDocumentSheet` §
  // "Upload closes the sheet at once").
  // Held with the chapter it was sent from, so a chapter switch (which mounts
  // a new sheet) doesn't show the last chapter's upload in this one's list.
  const [pendingFor, setPendingFor] = useState<{
    chapterId: string | null;
    upload: PendingDocumentUpload | null;
  }>({ chapterId: null, upload: null });
  const uploadSheetRef = useRef<BottomSheetModal>(null);
  const canUpload = can("chapter_docs:upload", usePermissionList());
  const chapterId = useActiveChapterId();
  const pendingUpload =
    pendingFor.chapterId === (chapterId ?? null) ? pendingFor.upload : null;
  const setPendingUpload = (
    next:
      | PendingDocumentUpload
      | null
      | ((
          current: PendingDocumentUpload | null,
        ) => PendingDocumentUpload | null),
  ) =>
    setPendingFor((prev) => {
      const current =
        prev.chapterId === (chapterId ?? null) ? prev.upload : null;
      return {
        chapterId: chapterId ?? null,
        upload: typeof next === "function" ? next(current) : next,
      };
    });

  // Deferred, so a long library re-ranks behind the keystroke rather than
  // ahead of it, as web's does.
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<DocumentSort>("name");
  const [pickedUploader, setPickedUploader] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<"semester" | "30d" | null>(null);
  const [kind, setKind] = useState<FileKind | null>(null);
  // Pinned and Starred (#4290), each on or off; both on shows either.
  const [markFilter, setMarkFilter] =
    useState<DocumentMarkFilter>(NO_MARK_FILTER);
  // A file starred or pinned from the sheet while one of them is on stays in
  // the list until the filter changes, rather than vanishing (#4290).
  const { held, hold } = useMarkFilterHold(markFilter);
  // The filter and sort sheets (#5278): one tap on a chip or the sort
  // control, one pick in the sheet.
  const typeSheetRef = useRef<BottomSheetModal>(null);
  const uploaderSheetRef = useRef<BottomSheetModal>(null);
  const dateSheetRef = useRef<BottomSheetModal>(null);
  const sortSheetRef = useRef<BottomSheetModal>(null);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Deleted here and gone from the list at once: `useDeleteDocument`'s
  // invalidation re-reads the library without the mutation awaiting it, so
  // the row would otherwise sit there, pressable, until the re-read lands.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Held with the chapter it failed in, as `pendingFor` is.
  const [deleteFailure, setDeleteFailure] = useState<{
    chapterId: string | null;
    message: string;
  } | null>(null);
  const canManage = can("chapter_docs:manage", usePermissionList());
  const { accent, accentOnPrimary } = useChapterBranding();

  // Pins and stars (#3934). A star moves on the tap and settles on the
  // server's answer (`useSetDocumentStar`); a pin moves once the server has it.
  const starsQuery = useDocumentStars();
  const setStar = useSetDocumentStar();
  const setPin = useSetDocumentPin();
  const actionsSheetRef = useRef<BottomSheetModal>(null);
  const [actionsTarget, setActionsTarget] =
    useState<DocumentActionsTarget | null>(null);
  // Held with the chapter it failed in, as `deleteFailure` is.
  const [markFailure, setMarkFailure] = useState<{
    chapterId: string | null;
    message: string;
  } | null>(null);
  const starredFolders = useMemo(
    () => new Set(starsQuery.data?.folder_ids ?? []),
    [starsQuery.data],
  );
  const starredDocuments = useMemo(
    () => new Set(starsQuery.data?.document_ids ?? []),
    [starsQuery.data],
  );

  const foldersQuery = useDocumentFolders();
  const documentsQuery = useDocuments();
  const openDocument = useDocumentDownloadUrl();
  const deleteDocument = useDeleteDocument();
  const refresh = useRefetchAll([foldersQuery, documentsQuery, starsQuery]);

  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  // A lock on a file not everyone can see (#5216), by web's rule.
  const isLimited = useMemo(
    () =>
      limitedDocumentCheck(foldersQuery.data === undefined ? null : folders),
    [foldersQuery.data, folders],
  );
  const documents = useMemo(
    () =>
      selectDocuments(documentsQuery.data).filter(
        (doc) => !removedIds.has(doc.id),
      ),
    [documentsQuery.data, removedIds],
  );
  const filters = useMemo(
    () => ({
      uploader: pickedUploader,
      date: datePreset === null ? null : { preset: datePreset },
      kind,
      marks: markFilter,
    }),
    [pickedUploader, datePreset, kind, markFilter],
  );
  // Web's own hook (#3938): uploader names and the kept-pick rule, the
  // semester window, the ticking clock, the folder, then search, filters and
  // order.
  const {
    visible,
    uploaders,
    kinds,
    filters: applied,
    semesterKnown,
    filtering,
  } = useDocumentLibrary({
    documents,
    folder,
    search: deferredSearch,
    filters,
    sort,
    namesById: useMemberDisplayNames().byId,
    semesters: useSemesters().data,
    starred: starredDocuments,
    keep: held,
  });
  // On All with no search or filter the tiers are cards above the list, and
  // the list keeps its order; anywhere else they lead the list (#3934).
  const showCards = folder === null && !filtering && deferredSearch === "";
  // The tiers and the cards come from the builders web's `/documents` uses
  // too (`@repo/hooks/document-library`), so the two apps can't disagree.
  const rows = useMemo(
    () => (showCards ? visible : tierRows(visible, starredDocuments)),
    [visible, showCards, starredDocuments],
  );
  const cards = useMemo(
    () =>
      markedItems({
        folders,
        library: documents,
        shown: visible.map((row) => row.doc),
        starredFolders,
        starredDocuments,
      }),
    [documents, folders, visible, starredFolders, starredDocuments],
  );
  /*
    The folders as a tree (#5337, Shawn's pick of option C), the way web's
    rail draws them (`document-folder-tree.ts`): a folder named by its path
    sits under its parent and reads its own name. A sideways chip row can't
    indent, so the chips show one level at a time and step in and out, as the
    Files app and Google Drive's phone app walk a tree. The top level runs
    pinned, then starred, then the rest (#3934), each marked folder bringing
    what is under it.
  */
  const folderForest = useMemo(() => {
    const tiers = liftMarkedFolders(
      buildFolderTree(folders),
      (entry) => !!entry.pinned_at,
      (entry) => starredFolders.has(entry.id),
    );
    return [...tiers.pinned, ...tiers.starred, ...tiers.rest];
  }, [folders, starredFolders]);
  const folderNames = useMemo(
    () => new Set(folders.map((entry) => entry.name)),
    [folders],
  );
  const chipLevel = useMemo(
    () => folderLevel(folderForest, folder),
    [folderForest, folder],
  );
  /*
    A folder chip: its own name, its marks before it, and a chevron after it
    when it holds folders, so a tap that steps in is expected. A long press
    opens the folder's Star and Pin sheet (#3934); a folder both pinned and
    starred wears both marks.
  */
  function folderChip(
    node: FolderTreeNode<(typeof folders)[number]>,
    back = false,
  ): FilterChip {
    const entry = node.folder;
    const on = folder === entry.name;
    const holdsFolders =
      !back && node.children.length > 0 && node !== chipLevel.level;
    /*
      A pinned or starred folder lifted to the top row, away from the folder
      it sits in, says which folder that is ("Flyers · 2024"), so two
      "Flyers" read apart, as web's rail and both apps' cards do (#5337).
    */
    const where =
      !back && chipLevel.level === null && node.parentName
        ? node.parentName
        : null;
    const label = where
      ? `${node.label} · ${folderPlace(where, folderNames).label}`
      : node.label;
    const marked =
      !!entry.pinned_at || starredFolders.has(entry.id) || !!entry.who_can_see;
    const mark = back ? (
      <BackGlyph color={tokens.color.text.mutedForeground} size={14} />
    ) : marked ? (
      <View style={styles.marks}>
        {entry.who_can_see ? (
          <LimitedMark
            color={on ? accentOnPrimary : tokens.color.text.mutedForeground}
          />
        ) : null}
        {entry.pinned_at ? (
          <PinGlyph color={on ? accentOnPrimary : accent} on size={14} />
        ) : null}
        {starredFolders.has(entry.id) ? (
          <StarGlyph color={on ? accentOnPrimary : accent} on size={14} />
        ) : null}
      </View>
    ) : undefined;
    return {
      value: entry.name,
      label,
      mark,
      trailing: holdsFolders ? (
        <ForwardGlyph
          color={on ? accentOnPrimary : tokens.color.text.mutedForeground}
          size={14}
        />
      ) : undefined,
      accessibilityLabel: back
        ? `Back to ${node.label}`
        : [
            node.label,
            where ? `in ${where}` : null,
            holdsFolders ? "holds folders" : null,
          ]
            .filter(Boolean)
            .join(", ") || undefined,
      onLongPress: () => openActions(folderTarget(entry)),
      longPressLabel: canManage ? "Star or pin" : "Star or unstar",
    };
  }
  /*
    At the top: All, then the top-level folders. Inside a folder that holds
    others: a chip back to the level above (All at the top), the folder
    itself, then its folders, so its own files stay one tap away.
  */
  const folderChips: FilterChip[] = chipLevel.level
    ? [
        chipLevel.up
          ? folderChip(chipLevel.up, true)
          : {
              value: null,
              label: "All",
              mark: (
                <BackGlyph
                  color={tokens.color.text.mutedForeground}
                  size={14}
                />
              ),
              accessibilityLabel: "Back to All",
            },
        folderChip(chipLevel.level),
        ...chipLevel.items.map((node) => folderChip(node)),
      ]
    : [
        { value: null, label: "All" },
        ...chipLevel.items.map((node) => folderChip(node)),
      ];

  const markFailed =
    markFailure && markFailure.chapterId === (chapterId ?? null)
      ? markFailure.message
      : null;

  // The sheet presents once its target is set, so a press only sets state.
  // Each press makes a new target object, so the same row twice reopens it.
  function openActions(target: DocumentActionsTarget) {
    setActionsTarget(target);
  }
  useEffect(() => {
    if (actionsTarget) actionsSheetRef.current?.present();
  }, [actionsTarget]);

  function folderTarget(entry: {
    id: string;
    name: string;
    pinned_at?: string | null;
  }) {
    return {
      kind: "folder" as const,
      id: entry.id,
      name: entry.name,
      pinned: !!entry.pinned_at,
      starred: starredFolders.has(entry.id),
    };
  }

  function documentTarget(doc: {
    id: string;
    title: string;
    pinned_at: string | null;
    drive_file_id?: string | null;
  }) {
    return {
      kind: "document" as const,
      id: doc.id,
      name: doc.title,
      pinned: !!doc.pinned_at,
      starred: starredDocuments.has(doc.id),
      fromDrive: isDriveCopy(doc),
    };
  }

  // `mutateAsync`, not `mutate` with per-call callbacks: TanStack runs a
  // `mutate` call's own `onError` only for the latest call on the hook, so a
  // star that failed while a second was in flight would fail silently.
  async function toggleStar(target: DocumentActionsTarget) {
    setMarkFailure(null);
    const next = !target.starred;
    if (target.kind === "document") hold(target.id);
    try {
      await setStar.mutateAsync({
        target: { kind: target.kind, id: target.id },
        starred: next,
      });
      AccessibilityInfo.announceForAccessibility(
        next ? `Starred “${target.name}”.` : `Unstarred “${target.name}”.`,
      );
    } catch (caught) {
      setMarkFailure({
        chapterId: chapterId ?? null,
        message: errorCopy(
          caught,
          `Couldn't ${next ? "star" : "unstar"} “${target.name}”. Try again in a moment.`,
        ),
      });
    }
  }

  async function togglePin(target: DocumentActionsTarget) {
    setMarkFailure(null);
    const next = !target.pinned;
    if (target.kind === "document") hold(target.id);
    try {
      await setPin.mutateAsync({
        target: { kind: target.kind, id: target.id },
        pinned: next,
      });
      AccessibilityInfo.announceForAccessibility(
        next
          ? `Pinned “${target.name}” for the chapter.`
          : `Unpinned “${target.name}”.`,
      );
    } catch (caught) {
      setMarkFailure({
        chapterId: chapterId ?? null,
        message: errorCopy(
          caught,
          `Couldn't ${next ? "pin" : "unpin"} “${target.name}”. Try again in a moment.`,
        ),
      });
    }
  }

  const uploader = applied.uploader;
  const dateActive = isActiveDateFilter(applied.date, semesterKnown);
  const filterCount =
    (uploader !== null ? 1 : 0) +
    (dateActive ? 1 : 0) +
    (kind !== null ? 1 : 0) +
    (markFilter.pinned ? 1 : 0) +
    (markFilter.starred ? 1 : 0);
  const deleteFailed =
    deleteFailure && deleteFailure.chapterId === (chapterId ?? null)
      ? deleteFailure.message
      : null;

  // The empty state's way out (web's Clear filters): the search too.
  function clearFilters() {
    setSearch("");
    clearFilterChips();
  }

  // The chip row's Clear (#5278): the filters it holds, not what was typed.
  function clearFilterChips() {
    setPickedUploader(null);
    setDatePreset(null);
    setKind(null);
    setMarkFilter(NO_MARK_FILTER);
  }

  // The latest tap's number, and whether a share sheet is already up.
  const latestOpen = useRef(0);
  const presenting = useRef(false);
  // Leaving s12 (back pops it) supersedes any tap still downloading, so its
  // sheet never comes up over the screen the member went to.
  useEffect(
    () => () => {
      latestOpen.current += 1;
    },
    [],
  );

  async function open(id: string) {
    // One sheet at a time: iOS rejects a second presentation while one is
    // showing, which is a rejection worth not provoking rather than reporting.
    if (presenting.current) return;
    // Before that, the latest tap wins. A tap on another row while one is
    // still fetching its signed URL or downloading its file moves the spinner
    // to that row, and the earlier row's file is dropped when it lands rather
    // than presented over the document the member asked for since.
    const tap = ++latestOpen.current;
    const isLatest = () => tap === latestOpen.current;
    let presented = false;
    setOpenFailed(false);
    setOpeningId(id);
    try {
      const payload = await openDocument.mutateAsync(id);
      if (!isLatest()) return;
      const shared = await shareDocumentFile(id, payload, () => {
        if (!isLatest() || presenting.current) return false;
        presented = true;
        presenting.current = true;
        return true;
      });
      if (!shared && isLatest()) setOpenFailed(true);
    } catch {
      if (isLatest()) setOpenFailed(true);
    } finally {
      if (presented) presenting.current = false;
      if (isLatest()) setOpeningId(null);
    }
  }

  // Filed: the pending row holds until the list has re-read, so the document
  // arrives as the row goes instead of a beat later. A later upload's row is left alone.
  function uploaded(title: string) {
    AccessibilityInfo.announceForAccessibility(`“${title}” is in the library.`);
    const filed = pendingUpload;
    void documentsQuery.refetch().finally(() => {
      setPendingUpload((current) =>
        current === filed || current?.title === title ? null : current,
      );
    });
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert(
      deleteDocumentTitle(title),
      DELETE_DOCUMENT_BODY,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: DELETE_DOCUMENT_LABEL,
          style: "destructive",
          onPress: () => void remove(id, title),
        },
      ],
      { cancelable: true },
    );
  }

  async function remove(id: string, title: string) {
    setDeleteFailure(null);
    setDeletingIds((current) => new Set(current).add(id));
    try {
      await deleteDocument.mutateAsync(id);
      setRemovedIds((current) => new Set(current).add(id));
      AccessibilityInfo.announceForAccessibility(`“${title}” was deleted.`);
    } catch (caught) {
      // A refusal that names its reason (a read-only chapter, a file already
      // gone) says it; anything else is worth another try.
      setDeleteFailure({
        chapterId: chapterId ?? null,
        message: errorCopy(
          caught,
          `Couldn't delete “${title}”. Try again in a moment.`,
        ),
      });
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  // The upload in flight, or the one that failed, heading the list. Same two
  // lines as a document row; when it files, the row goes and the document
  // takes its place in the chosen order (Name A–Z by default, so usually not
  // the top). "Uploading…" is the quiet caption, no spinner. A failure says
  // so in the destructive hue and reopens the sheet, which kept the draft.
  const pendingRow = pendingUpload ? (
    <ListRow
      key="pending-upload"
      label={pendingUpload.title}
      description={
        pendingUpload.failed ? "Didn't upload. Tap to try again." : "Uploading…"
      }
      descriptionTone={pendingUpload.failed ? "destructive" : "default"}
      accessibilityHint={pendingUpload.failed ?? undefined}
      onPress={
        pendingUpload.failed
          ? () => uploadSheetRef.current?.present()
          : undefined
      }
    />
  ) : null;

  function renderList() {
    if (documentsQuery.isPending) {
      // Document rows in the list's own section: a title and its meta line.
      return (
        <SkeletonRegion label="Loading chapter documents">
          <ListSection>
            {Array.from({ length: 4 }, (_, index) => (
              <ListRowSkeleton key={index} index={index} description />
            ))}
          </ListSection>
        </SkeletonRegion>
      );
    }
    if (documentsQuery.isError && documentsQuery.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load documents"
          body={describeLoadFailure(documentsQuery.error)}
          onRetry={() => void documentsQuery.refetch()}
          isRetrying={documentsQuery.isFetching}
        />
      );
    }
    if (rows.length === 0 && !pendingRow) {
      // Empty-states plan rule 7: one line where the rows would be. A search
      // or filter that matched nothing says so and offers the way out: inside
      // a folder chip, widening to every folder (the search and filters
      // stay); otherwise clearing them, as web's Clear filters does.
      // Uploading lives on the screen's + (writing.md § Chapter Documents).
      if (filtering) {
        const what = deferredSearch ? `“${deferredSearch}”` : "these filters";
        return folder ? (
          <InlineNote
            action={{
              label: "Search all files",
              onPress: () => setFolder(null),
            }}
          >
            {`Nothing in ${folder} matches ${what}.`}
          </InlineNote>
        ) : (
          <InlineNote
            action={{
              label:
                deferredSearch &&
                uploader === null &&
                !dateActive &&
                kind === null &&
                !markFilter.pinned &&
                !markFilter.starred
                  ? "Clear search"
                  : "Clear filters",
              onPress: clearFilters,
            }}
          >
            {`No documents match ${what}.`}
          </InlineNote>
        );
      }
      return (
        <InlineNote>
          {folder ? `Nothing in ${folder} yet.` : "No documents yet."}
          {canUpload ? " Tap + to upload one." : null}
        </InlineNote>
      );
    }
    if (layout === "grid") {
      return (
        <>
          {/* The upload in flight stays a row, heading the tiles. */}
          {pendingRow ? <ListSection>{pendingRow}</ListSection> : null}
          <DocumentTiles
            rows={rows}
            isStarred={(id) => starredDocuments.has(id)}
            isLimited={isLimited}
            busyIds={
              new Set(
                [...deletingIds, openingId].filter(
                  (id): id is string => id !== null,
                ),
              )
            }
            deletingIds={deletingIds}
            actionsLabel={canManage ? "Star, pin or delete" : "Star or unstar"}
            onOpen={(doc) => void open(doc.id)}
            onActions={(doc) => openActions(documentTarget(doc))}
          />
        </>
      );
    }
    return (
      <ListSection>
        {pendingRow}
        {rows.map((row) => (
          <ListRow
            key={row.doc.id}
            label={row.doc.title}
            description={documentMeta(row)}
            accessibilityHint="Opens the share sheet to save it or open it in another app."
            // Only the row being opened, or deleted, shows it. The others
            // stay as they are and take a tap, which moves the spinner to
            // them (`open`).
            busy={row.doc.id === openingId || deletingIds.has(row.doc.id)}
            onPress={() => void open(row.doc.id)}
            // Star for everyone; Pin and Delete for `chapter_docs:manage`
            // (#3934). The row's pin or star shows in its label's tail.
            onLongPress={() => openActions(documentTarget(row.doc))}
            longPressLabel={
              canManage ? "Star, pin or delete" : "Star or unstar"
            }
            trailing={
              row.doc.pinned_at ||
              starredDocuments.has(row.doc.id) ||
              isLimited(row.doc) ? (
                <View style={styles.marks}>
                  {isLimited(row.doc) ? (
                    <LimitedMark color={tokens.color.text.mutedForeground} />
                  ) : null}
                  {row.doc.pinned_at ? (
                    <PinGlyph color={accent} on size={14} />
                  ) : null}
                  {starredDocuments.has(row.doc.id) ? (
                    <StarGlyph color={accent} on size={14} />
                  ) : null}
                </View>
              ) : undefined
            }
            accessibilityValue={
              [
                isLimited(row.doc) ? LIMITED_LABEL : null,
                row.doc.pinned_at ? "Pinned for the chapter" : null,
                starredDocuments.has(row.doc.id) ? "Starred" : null,
              ]
                .filter(Boolean)
                .join(", ") || undefined
            }
          />
        ))}
      </ListSection>
    );
  }

  const kindLabel = kinds.find((option) => option.value === kind)?.label;
  const uploaderLabel = uploaders.find(
    (option) => option.value === uploader,
  )?.label;
  const dateOptions = [
    { value: null, label: "Any time" },
    // Offered once the archives have loaded, as on web.
    ...(semesterKnown ? [{ value: "semester", label: "This semester" }] : []),
    { value: "30d", label: "Last 30 days" },
  ];
  const dateLabel = dateActive
    ? dateOptions.find((option) => option.value === datePreset)?.label
    : undefined;
  const sortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Name A–Z";
  const anyFilter = filterCount > 0;

  /*
    The filters, each a chip that names what it holds (#5278), as Google
    Drive's Type, People and Modified chips do on a phone: a tap opens the
    choices in a sheet, a pick applies and closes. Starred and Pinned stay
    toggles (#4290). Lit while set; Clear leads the row once anything is.
  */
  const filterRow = (
    <ChipRow scroll>
      {anyFilter ? (
        <Chip
          accessibilityRole="button"
          accessibilityState={{}}
          accessibilityLabel="Clear filters"
          label="Clear"
          on={false}
          onPress={clearFilterChips}
        />
      ) : null}
      {kinds.length > 0 ? (
        <MenuChip
          name="Type"
          value={kindLabel}
          hint="Opens the file types."
          onPress={() => typeSheetRef.current?.present()}
        />
      ) : null}
      {uploaders.length > 0 ? (
        <MenuChip
          name="Uploaded by"
          value={uploaderLabel}
          hint="Opens who uploaded files."
          onPress={() => uploaderSheetRef.current?.present()}
        />
      ) : null}
      <MenuChip
        name="Date added"
        value={dateLabel}
        hint="Opens date ranges."
        onPress={() => dateSheetRef.current?.present()}
      />
      {(
        [
          ["starred", "Starred", StarGlyph],
          ["pinned", "Pinned", PinGlyph],
        ] as const
      ).map(([key, label, Glyph]) => {
        const on = markFilter[key];
        return (
          <Chip
            key={key}
            accessibilityRole="togglebutton"
            accessibilityState={{ checked: on }}
            label={label}
            on={on}
            onPress={() =>
              setMarkFilter((prev) => ({ ...prev, [key]: !prev[key] }))
            }
            mark={
              <Glyph
                color={on ? accentOnPrimary : tokens.color.text.muted}
                on={on}
                size={14}
              />
            }
          />
        );
      })}
    </ChipRow>
  );

  return (
    <ScreenShell
      back={BACK_TO_YOU}
      refresh={refresh}
      createAction={
        canUpload
          ? {
              label: "Upload document",
              hint: "Opens a sheet to upload a file or a photo to the library.",
              onPress: () => uploadSheetRef.current?.present(),
            }
          : undefined
      }
      title="Documents"
      headerAction={<ListLayoutToggle screen="documents" />}
    >
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search documents"
        accessibilityLabel="Search documents"
        searchGlyph
      />

      {folders.length > 0 ? (
        <FilterChips
          // A new row for each level, so it starts at its back chip rather
          // than keeping the scroll the last level was at (#5337).
          key={chipLevel.level?.folder.name ?? "top"}
          accessibilityLabel="Filter by folder"
          scroll
          selected={folder}
          onSelect={setFolder}
          chips={folderChips}
        />
      ) : null}
      {filterRow}

      {openFailed ? (
        <Text style={styles.errorNote}>
          That document couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}
      {starsQuery.isError ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorNote}>
          Couldn&apos;t load your stars. Pull down to try again.
        </Text>
      ) : null}
      {markFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorNote}>
          {markFailed}
        </Text>
      ) : null}
      {deleteFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorNote}>
          {deleteFailed}
        </Text>
      ) : null}

      {showCards &&
      !documentsQuery.isPending &&
      !(documentsQuery.isError && documentsQuery.data === undefined) ? (
        <MarkedCards
          pinned={cards.pinned}
          starred={cards.starred}
          folderNames={folderNames}
          isStarred={(item) =>
            item.kind === "folder"
              ? starredFolders.has(item.folder.id)
              : starredDocuments.has(item.doc.id)
          }
          isLimited={(item) =>
            item.kind === "folder"
              ? !!item.folder.who_can_see
              : isLimited(item.doc)
          }
          openingId={openingId}
          deletingIds={deletingIds}
          actionsLabel={canManage ? "Star, pin or delete" : "Star or unstar"}
          onOpenFolder={setFolder}
          onOpenDocument={(id) => void open(id)}
          onActions={(item) =>
            openActions(
              item.kind === "folder"
                ? folderTarget(item.folder)
                : documentTarget(item.doc),
            )
          }
        />
      ) : null}

      {/* The count and, across from it, the order (#5278), as Files, Drive
          and Dropbox put "Name ↑" over their lists: one tap opens the sort. */}
      <View style={styles.listHeader}>
        <SectionHeader>
          {documentsQuery.isSuccess
            ? `${visible.length} ${visible.length === 1 ? "document" : "documents"}`
            : "Documents"}
        </SectionHeader>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${sortLabel}`}
          accessibilityHint="Opens the sort orders."
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          onPress={() => sortSheetRef.current?.present()}
          style={({ pressed }) => [
            styles.sortControl,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.sortLabel}>{sortLabel}</Text>
          <DisclosureGlyph
            color={tokens.color.text.mutedForeground}
            size={14}
            direction="down"
          />
        </Pressable>
      </View>
      {renderList()}

      <OptionSheet
        ref={sortSheetRef}
        title="Sort by"
        options={SORT_OPTIONS}
        selected={sort}
        onSelect={(value) => setSort((value as DocumentSort | null) ?? "name")}
      />
      <OptionSheet
        ref={typeSheetRef}
        title="File type"
        options={[{ value: null, label: "Any type" }, ...kinds]}
        selected={kind}
        onSelect={(value) => setKind(value as FileKind | null)}
      />
      <OptionSheet
        ref={uploaderSheetRef}
        title="Uploaded by"
        options={[{ value: null, label: "Anyone" }, ...uploaders]}
        selected={uploader}
        onSelect={setPickedUploader}
      />
      <OptionSheet
        ref={dateSheetRef}
        title="Date added"
        options={dateOptions}
        selected={dateActive ? datePreset : null}
        onSelect={(value) => setDatePreset(value as "semester" | "30d" | null)}
      />

      <DocumentActionsSheet
        ref={actionsSheetRef}
        target={actionsTarget}
        canManage={canManage}
        onToggleStar={(target) => void toggleStar(target)}
        onTogglePin={(target) => void togglePin(target)}
        onDelete={(target) => confirmDelete(target.id, target.name)}
      />

      {canUpload ? (
        <UploadDocumentSheet
          // A new sheet per chapter: a kept draft belongs to the chapter it
          // was started in, and a retry the sheet holds after a failed
          // confirm names a path minted under the chapter it was sent from.
          key={chapterId ?? "no-chapter"}
          ref={uploadSheetRef}
          folders={folders}
          initialFolder={folder}
          onUploaded={uploaded}
          onPending={setPendingUpload}
          // Kept past this screen (#4593): going back and coming here again
          // opens Upload on the draft left in it.
          keptDraft="documents-upload"
        />
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // On the count's baseline: the caption carries a top margin, which
    // centring would split.
    listHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
    },
    sortControl: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
    },
    sortLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.7,
    },
    marks: {
      flexDirection: "row",
      gap: tokens.spacing.xs,
    },
    errorNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
