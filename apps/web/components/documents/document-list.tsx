"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NestedError,
  NestedOffline,
} from "@/components/shared/nested-states";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { SearchGlyph } from "@/components/documents/resources-glyphs";
import { DocumentRow } from "@/components/documents/document-row";
import type { ChapterDocument } from "@/components/documents/document-types";
import { SectionLabel } from "@/components/shared/section-label";
import {
  dashboardToolbarSearchClassName,
  dashboardToolbarSearchGlyphClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import { DocumentRowsSkeleton } from "@/components/documents/documents-skeleton";

export type DocumentListState =
  "offline-search" | "offline" | "loading" | "error" | "empty" | "ready";

export function DocumentList({
  listState,
  loadError,
  visible,
  activeFolder,
  search,
  setSearch,
  deferredSearch,
  onRetry,
  gate,
  deletingIds,
  onOpen,
  onDelete,
  onShowAllFiles,
  onUpload,
}: {
  listState: DocumentListState;
  /** The failed read behind `listState === "error"`, for its wording. */
  loadError?: unknown;
  visible: ChapterDocument[];
  activeFolder: string | null;
  search: string;
  setSearch: (search: string) => void;
  deferredSearch: string;
  onRetry: () => void;
  gate: SubscriptionGate;
  deletingIds: ReadonlySet<string>;
  /** Opens a document in the viewer (#3849). */
  onOpen: (doc: ChapterDocument) => void;
  onDelete: (doc: ChapterDocument) => void;
  /** Leaves the folder for "All files". */
  onShowAllFiles: () => void;
  /** Opens the upload panel; absent for a viewer who can't upload. */
  onUpload?: () => void;
}) {
  return (
    <section aria-labelledby="doc-list-label">
      {/*
        One toolbar row, not a card header: the list's own name and count
        on the left, its search on the right, sitting directly on the page
        surface. `1f` pin 2.
      */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/*
          The count renders only once there is one to state. A placeholder
          character would put a stray non-breaking space in the
          accessibility tree, and "0 documents." while the query is still
          in flight is a claim about the library rather than a description
          of it — the state below already says what is happening.
        */}
        <SectionLabel
          id="doc-list-label"
          count={
            listState === "ready"
              ? `${visible.length} document${visible.length === 1 ? "" : "s"}${deferredSearch ? ` matching "${deferredSearch}"` : ""}`
              : null
          }
        >
          {activeFolder === null
            ? "All documents"
            : activeFolder === ""
              ? "Uncategorized documents"
              : activeFolder}
        </SectionLabel>
        {/*
          `type="search"`, not `type="text"`: it gets the browser's own
          clear affordance and the correct role, so no hand-rolled X button
          is owed. The visible <Label> is `sr-only` rather than absent — a
          placeholder is not an accessible name.

          Icon placement follows the dashboard's existing search inputs
          (`events-page.tsx`, `alumni-directory.tsx`): the shared glyph at a
          glyph class sized against the toolbar field. The wrapper carries the
          spacing so the icon offset never has to compensate for it.
        */}
        <div className="relative w-full sm:w-64">
          <Label htmlFor="doc-search" className="sr-only">
            Search documents
          </Label>
          <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
          <Input
            id="doc-search"
            type="search"
            className={dashboardToolbarSearchClassName}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title"
          />
        </div>
      </div>
      <div className="pt-2">
        {/*
          Still the nested variants even though the card they were chosen
          for is gone. They paint no fill of their own, and the page is now
          `--background` rather than `--card` — so the whole-screen variants
          would paint a `--card` block where nothing else on the page has
          one, reintroducing by the back door the card this lane deleted.
          `components.md` §10 is about the 1.00:1 composite; the reason they
          are right here is the flatter one, that these states sit inside a
          region rather than replacing the screen.
        */}
        {listState === "offline-search" ? (
          <NestedOffline
            sole
            title="Search needs a connection"
            description="Clear the search to browse the documents already on this device."
          />
        ) : listState === "offline" ? (
          <NestedOffline
            sole
            title="Documents unavailable offline"
            description="Reconnect to browse the chapter library and download files."
            onRetry={onRetry}
          />
        ) : listState === "loading" ? (
          <DocumentRowsSkeleton />
        ) : listState === "error" ? (
          <NestedError
            sole
            title="Couldn't load documents"
            description={describeLoadFailure(loadError)}
            onRetry={onRetry}
          />
        ) : listState === "empty" ? (
          /*
            One line where the rows go, not a card (empty-states plan rule
            7). A search that matched nothing is not an empty library, and
            offering "upload some files" to a member who mistyped a title
            answers a question they did not ask, so a miss offers only the
            way back. An empty library or folder offers its first upload to
            someone who can, here where the first row will land; the whole
            page is a drop target too.
          */
          deferredSearch ? (
            <InlineNote>
              {activeFolder === null ? (
                <>
                  No documents match “{deferredSearch}”.{" "}
                  <InlineNoteAction onClick={() => setSearch("")}>
                    Clear search
                  </InlineNoteAction>
                </>
              ) : (
                <>
                  {activeFolder === ""
                    ? `No documents outside a folder match “${deferredSearch}”.`
                    : `Nothing in ${activeFolder} matches “${deferredSearch}”.`}{" "}
                  <InlineNoteAction onClick={onShowAllFiles}>
                    Search all files
                  </InlineNoteAction>
                </>
              )}
            </InlineNote>
          ) : (
            <InlineNote>
              {activeFolder === null
                ? "No documents yet."
                : activeFolder === ""
                  ? "Every document is in a folder."
                  : `Nothing in ${activeFolder} yet.`}
              {onUpload ? (
                <>
                  {" "}
                  <InlineNoteAction
                    onClick={onUpload}
                    {...gate.controlProps()}
                  >
                    Upload a file
                  </InlineNoteAction>{" "}
                  or drop one anywhere on this page.
                </>
              ) : null}
            </InlineNote>
          )
        ) : (
          /*
            `divide-border/70` dilutes `--border` to 1.169:1 on a card
            against the token's 1.253:1, and neither clears the 3:1
            non-text floor — `components.md` §2: "a hairline's alpha is
            not a free parameter". Chapter Ops found five of these; this
            is the sixth.
          */
          /*
            The board's list grammar (`4d`): a top hairline per row and
            nothing else — no card, no zebra, no per-row fill. The recipe,
            and the reason its hairline is undiluted, now live on
            `denseListClassName`; the Directory lane extracted them when it
            became the third and fourth copy of the same string.
          */
          <ul className={denseListClassName}>
            {visible.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                gate={gate}
                deleting={deletingIds.has(doc.id)}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
