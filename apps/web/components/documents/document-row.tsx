"use client";

import { Download, Loader2, Trash2, Users } from "lucide-react";
import { formatDay } from "@repo/formatting";
import { memberAvatarTint, useMyPermissions } from "@repo/hooks";
import { can } from "@repo/validation";
import {
  effectiveLine,
  isDriveCopy,
  uploadedLine,
} from "@repo/hooks/document-library";
import { IconButton } from "@/components/ui/icon-button";
import { FOCUS_RING } from "@/components/ui/focus";
import { Can } from "@/components/shared/can";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import {
  DocumentsGlyph,
  PinGlyph,
  StarGlyph,
} from "@/components/documents/resources-glyphs";
import { OPEN_DOCUMENT_ATTRIBUTE } from "@/components/documents/document-viewer";
import { KEEP_FOCUS_ATTRIBUTE } from "@/components/documents/use-keep-focus";
import { LimitedMark } from "@/components/documents/document-access";
import { useDocumentDownload } from "@/components/documents/use-document-download";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { ChapterDocument } from "@/components/documents/document-types";
import { cn } from "@/lib/utils";

/**
 * What a file row says about a file, in the row's order: when and by whom,
 * then where and what, then the description.
 */
export function documentFacts(
  doc: ChapterDocument,
  uploader: string | null,
): { uploaded: string | null; filed: string[]; description: string | null } {
  return {
    uploaded: uploadedLine(
      formatDay(doc.created_at),
      uploader,
      isDriveCopy(doc),
    ),
    filed: [doc.folder, doc.document_type, effectiveFact(doc)].filter(
      (part): part is string => !!part,
    ),
    description: doc.description || null,
  };
}

function effectiveFact(doc: ChapterDocument): string | null {
  return effectiveLine(
    formatDay(doc.effective_date),
    formatDay(doc.created_at),
  );
}

function DownloadButton({ id, title }: { id: string; title: string }) {
  const { download, fetchingId } = useDocumentDownload();
  const isFetching = fetchingId === id;

  /*
    Icon-only, like Delete beside it (components.md § Icon-only actions). The
    word used to stay, on the grounds that an icon-only download needs a
    tooltip to be usable. `IconButton` carries one: the native `title`, plus
    the `aria-label` a screen reader reads.
  */
  return (
    <IconButton
      label={`Download ${title}`}
      onClick={() => void download(id)}
      disabled={isFetching}
      aria-busy={isFetching}
    >
      {isFetching ? <Loader2 className="animate-spin" /> : <Download />}
    </IconButton>
  );
}

/**
 * The tile that leads a file row (#5576): the file glyph on its folder's hue
 * (`documentFolderHues`), painted the way an initials avatar is
 * (`memberAvatarTint`), so a library reads by where things are filed at a
 * glance. The folder is in the row's words already, so the tile is
 * decoration to a screen reader.
 */
function FolderHueTile({ hue }: { hue: string }) {
  const tint = memberAvatarTint(hue);
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
      style={{ backgroundColor: tint.fill, color: tint.text }}
    >
      <DocumentsGlyph className="h-4 w-4" />
    </span>
  );
}

/**
 * Where a row's controls sit (#5576). With a mouse they wait out of sight
 * and come up over the row's end on hover, or when a control in the row
 * takes focus, as Gmail's and Google Drive's row actions do, so the list
 * shows files rather than a strip of icons per file. Hidden by opacity, not
 * `invisible`, so Tab still reaches them and their focus brings them up;
 * `pointer-events-none` keeps a click at the end of a row from landing on a
 * control nobody can see. A touch screen has no hover, so there the same
 * actions sit behind one More button (`useRowActions` through `RowMenu`), as
 * Drive's and Dropbox's touch layouts put them. The same list opens on a
 * right-click or a long-press anywhere on the row.
 */
const ROW_CONTROLS_CLASS = [
  "shrink-0 pointer-coarse:hidden",
  "pointer-fine:absolute pointer-fine:inset-y-0 pointer-fine:right-0 pointer-fine:bg-card-hover pointer-fine:pl-2",
  "pointer-fine:pointer-events-none pointer-fine:opacity-0",
  "pointer-fine:group-hover/row:pointer-events-auto pointer-fine:group-hover/row:opacity-100",
  "pointer-fine:group-focus-within/row:pointer-events-auto pointer-fine:group-focus-within/row:opacity-100",
].join(" ");

export function DocumentRow({
  doc,
  uploader,
  hue,
  gate,
  deleting,
  starred,
  pinBusy,
  onOpen,
  onDelete,
  onToggleStar,
  onTogglePin,
  limited = false,
  onSetAccess,
}: {
  doc: ChapterDocument;
  /** Who uploaded it, when the roster can name them (#3852). */
  uploader: string | null;
  /** Its folder's hue, which its tile wears (#5576, `documentFolderHues`). */
  hue: string;
  gate: SubscriptionGate;
  deleting: boolean;
  /** The member starred this file for themselves (#3934). */
  starred: boolean;
  /** A pin write is in flight, so Pin waits. */
  pinBusy: boolean;
  /** Opens the document in the viewer (#3849). */
  onOpen: (doc: ChapterDocument) => void;
  onDelete: (doc: ChapterDocument) => void;
  onToggleStar: (doc: ChapterDocument) => void;
  onTogglePin: (doc: ChapterDocument) => void;
  /** Not everyone can see it: its own list, or its folder's (#3642 piece 1). */
  limited?: boolean;
  /** Opens Who can see; absent for a member who may not set it. */
  onSetAccess?: (doc: ChapterDocument) => void;
}) {
  const facts = documentFacts(doc, uploader);
  const pinned = !!doc.pinned_at;
  const entries = useRowActions({
    doc,
    gate,
    deleting,
    starred,
    pinBusy,
    onDelete,
    onToggleStar,
    onTogglePin,
    onSetAccess,
  });
  return (
    /*
      One line at every width (#5576): the tile, the title over its facts,
      and the controls, which a mouse brings up over the row's end. The row
      lifts to the hover step, which is how a transparent row says it opens
      something (components.md §2); the controls' backing takes the same
      step, so they sit on the row rather than on a patch of their own.

      The board's `4d` data row is 40px and this one is floored at 44 by
      `min-h-11`, deliberately: §2's touch-target floor outranks the board's
      density. Do not "correct" the row to 40 to match the board.
    */
    <RowMenu entries={entries} label={`More for ${doc.title}`}>
      {(menuButton) => (
        <li className="group/row relative flex min-h-11 items-center gap-2 py-1 transition-colors hover:bg-card-hover focus-within:bg-card-hover">
          {/*
        The tile and both lines are one button that opens the document
        (#3849), so the whole name is the target, not a word in it.
      */}
          <button
            type="button"
            onClick={() => onOpen(doc)}
            {...{ [OPEN_DOCUMENT_ATTRIBUTE]: doc.id }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left",
              FOCUS_RING,
            )}
          >
            <FolderHueTile hue={hue} />
            <span className="block min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                <span className="truncate">{doc.title}</span>
                {limited ? <LimitedMark className="text-muted" /> : null}
                {/*
              A star or pin stays in sight while the controls are away, as
              Drive's starred mark does: a mark is the file's state, not an
              action. The lit controls carry the names; these are the look.
            */}
                {pinned ? (
                  <PinGlyph
                    className="h-3.5 w-3.5 shrink-0 text-accent-text"
                    active
                  />
                ) : null}
                {starred ? (
                  <StarGlyph
                    className="h-3.5 w-3.5 shrink-0 text-accent-text"
                    active
                  />
                ) : null}
              </span>
              {/*
            Description LAST, and the order is load-bearing: the line is
            `truncate`, so whatever leads it is what survives a narrow row.
            The structured fields are short, bounded and the ones a member
            scans by; the description is the free-text field and the right
            thing to lose to an ellipsis.
          */}
              <span className="block truncate text-caption text-muted">
                {[facts.uploaded, ...facts.filed, facts.description]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
          <DocumentControls
            doc={doc}
            gate={gate}
            deleting={deleting}
            starred={starred}
            pinBusy={pinBusy}
            onDelete={onDelete}
            onToggleStar={onToggleStar}
            onTogglePin={onTogglePin}
            onSetAccess={onSetAccess}
            className={ROW_CONTROLS_CLASS}
          />
          {/*
        Touch only: with a mouse the hover controls above are the visible
        door, and the right-click menu holds the same list.
      */}
          <span className="hidden shrink-0 pointer-coarse:inline-flex">
            {menuButton}
          </span>
        </li>
      )}
    </RowMenu>
  );
}

// The menu's star and pin, solid while on, as the hover controls draw them.
const StarOnIcon = () => <StarGlyph className="h-4 w-4" active />;
const StarOffIcon = () => <StarGlyph className="h-4 w-4" active={false} />;
const PinOnIcon = () => <PinGlyph className="h-4 w-4" active />;
const PinOffIcon = () => <PinGlyph className="h-4 w-4" active={false} />;

/**
 * The row's actions as one menu (#5576): Star, Pin, Who can see, Download
 * and Delete, under the same names and gates as the hover controls. Opened
 * from the touch More button, or a right-click or long-press on the row.
 */
function useRowActions({
  doc,
  gate,
  deleting,
  starred,
  pinBusy,
  onDelete,
  onToggleStar,
  onTogglePin,
  onSetAccess,
}: Omit<Parameters<typeof DocumentControls>[0], "className">): RowMenuEntry[] {
  const { download, fetchingId } = useDocumentDownload();
  const permissions = useMyPermissions().data?.permissions;
  const canManage = !!permissions && can("chapter_docs:manage", permissions);
  const pinned = !!doc.pinned_at;
  const describedBy = gate.controlProps()["aria-describedby"];
  const entries: RowMenuEntry[] = [
    {
      type: "item",
      key: "star",
      label: starred ? "Unstar" : "Star",
      icon: starred ? StarOnIcon : StarOffIcon,
      disabled: !gate.allowed,
      describedBy,
      onSelect: () => onToggleStar(doc),
    },
  ];
  if (canManage) {
    entries.push({
      type: "item",
      key: "pin",
      label: pinned ? "Unpin for the chapter" : "Pin for the chapter",
      icon: pinned ? PinOnIcon : PinOffIcon,
      disabled: !gate.allowed || pinBusy,
      describedBy,
      onSelect: () => onTogglePin(doc),
    });
  }
  if (onSetAccess) {
    entries.push({
      type: "item",
      key: "access",
      label: "Who can see",
      icon: Users,
      disabled: !gate.allowed,
      describedBy,
      onSelect: () => onSetAccess(doc),
    });
  }
  entries.push({
    type: "item",
    key: "download",
    label: "Download",
    icon: Download,
    disabled: fetchingId === doc.id,
    onSelect: () => void download(doc.id),
  });
  // A copy of a Drive file has no Delete (see `DocumentControls`).
  if (canManage && !isDriveCopy(doc)) {
    entries.push({
      type: "item",
      key: "delete",
      label: "Delete",
      icon: Trash2,
      destructive: true,
      disabled: !gate.allowed || deleting,
      describedBy,
      onSelect: () => onDelete(doc),
    });
  }
  return entries;
}

/**
 * A file's own controls: Star, Pin, Who can see, Download and Delete.
 */
function DocumentControls({
  doc,
  gate,
  deleting,
  starred,
  pinBusy,
  onDelete,
  onToggleStar,
  onTogglePin,
  onSetAccess,
  className,
}: {
  doc: ChapterDocument;
  gate: SubscriptionGate;
  deleting: boolean;
  starred: boolean;
  pinBusy: boolean;
  onDelete: (doc: ChapterDocument) => void;
  onToggleStar: (doc: ChapterDocument) => void;
  onTogglePin: (doc: ChapterDocument) => void;
  onSetAccess?: (doc: ChapterDocument) => void;
  className?: string;
}) {
  const pinned = !!doc.pinned_at;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/*
        Star for everyone, Pin for whoever manages documents (#3934). Each
        stays lit while on, so a pinned or starred row says so in its
        controls rather than in another badge on the meta line. A member
        without `chapter_docs:manage` sees a pinned row's pin as a mark
        only, since they can't change it.
      */}
      <IconButton
        label={starred ? `Unstar ${doc.title}` : `Star ${doc.title}`}
        aria-pressed={starred}
        className={starred ? "text-accent-text" : undefined}
        {...{ [KEEP_FOCUS_ATTRIBUTE]: `star:${doc.id}` }}
        onClick={() => onToggleStar(doc)}
        {...gate.controlProps()}
      >
        <StarGlyph active={starred} />
      </IconButton>
      <Can
        permission="chapter_docs:manage"
        deniedFallback={
          pinned ? (
            <span
              className="inline-flex h-9 w-9 items-center justify-center text-accent-text"
              title="Pinned for the chapter"
            >
              <PinGlyph className="h-4 w-4" active />
              <span className="sr-only">Pinned for the chapter</span>
            </span>
          ) : null
        }
      >
        <IconButton
          label={
            pinned
              ? `Unpin ${doc.title} for the chapter`
              : `Pin ${doc.title} for the chapter`
          }
          aria-pressed={pinned}
          className={pinned ? "text-accent-text" : undefined}
          {...{ [KEEP_FOCUS_ATTRIBUTE]: `pin:${doc.id}` }}
          onClick={() => onTogglePin(doc)}
          {...gate.controlProps(pinBusy)}
        >
          <PinGlyph active={pinned} />
        </IconButton>
      </Can>
      {/*
        Who can see (#3642 piece 1), for its uploader and whoever manages
        documents, as Drive puts Share on each file's own row. The page
        decides who gets it, so it is absent rather than refused.
      */}
      {onSetAccess ? (
        <IconButton
          label={`Who can see ${doc.title}`}
          onClick={() => onSetAccess(doc)}
          {...gate.controlProps()}
        >
          <Users />
        </IconButton>
      ) : null}
      <DownloadButton id={doc.id} title={doc.title} />
      {/*
        A copy of a Drive file (#5157) has no Delete: Drive owns it, the API
        refuses, and the next sync would bring it back.
      */}
      <Can permission="chapter_docs:manage">
        {isDriveCopy(doc) ? null : (
          <>
            {/*
        `DELETE /v1/documents/:id` sits behind the same guard
        as upload, so gating only the upload trigger would
        have the page claim writes are blocked while still
        offering one per row.
      */}
            <IconButton
              label={`Delete ${doc.title}`}
              onClick={() => onDelete(doc)}
              {...gate.controlProps(deleting)}
            >
              <Trash2 />
            </IconButton>
          </>
        )}
      </Can>
    </div>
  );
}
