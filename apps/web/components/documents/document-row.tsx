"use client";

import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { selectDownloadUrl, useDocument } from "@repo/hooks";
import { formatDay } from "@repo/formatting";
import { IconButton } from "@/components/ui/icon-button";
import { Can } from "@/components/shared/can";
import { DocumentsGlyph } from "@/components/documents/resources-glyphs";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";
import type { ChapterDocument } from "@/components/documents/document-types";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage, labelled } from "@/lib/utils";

// Deliberately ungated: the signed link comes from `GET /v1/documents/:id`, and
// `enforceSubscription` returns early for GET — a lapsed chapter can still read
// everything it owns (§5 "writes only").
function DownloadButton({ id, title }: { id: string; title: string }) {
  const { toast } = useToast();
  const query = useDocument(id);
  const [isFetching, setIsFetching] = useState(false);

  async function handleDownload() {
    setIsFetching(true);
    try {
      const result = await query.refetch();
      const url = selectDownloadUrl(result.data);
      if (!url) throw new Error("No download URL returned.");
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({
        title: "Couldn't fetch download link",
        description: getErrorMessage(
          error,
          "Retry in a moment. Signed links are time-limited.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }

  /*
    Icon-only, like Delete beside it (components.md § Icon-only actions). The
    word used to stay, on the grounds that an icon-only download needs a
    tooltip to be usable. `IconButton` carries one: the native `title`, plus
    the `aria-label` a screen reader reads.
  */
  return (
    <IconButton
      label={`Download ${title}`}
      onClick={handleDownload}
      disabled={isFetching}
      aria-busy={isFetching}
    >
      {isFetching ? <Loader2 className="animate-spin" /> : <Download />}
    </IconButton>
  );
}

export function DocumentRow({
  doc,
  gate,
  deleting,
  onDelete,
}: {
  doc: ChapterDocument;
  gate: SubscriptionGate;
  deleting: boolean;
  onDelete: (doc: ChapterDocument) => void;
}) {
  return (
    /*
    Two lines, not three, and 8px of padding rather than 12. The
    description used to take a line of its own between the title
    and the meta; it now joins the meta line, which is where a
    one-clamped sentence was already headed and costs the row
    20px less.

    The board's `4d` data row is 40px and this one is floored at
    44 by `min-h-11`, deliberately: §2's touch-target floor
    outranks the board's density, and the 4px is the cheapest
    place in the lane to pay it. Do not "correct" the row to 40
    to match the board.
  */
    <li className="flex min-h-11 flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
      {/*
      s12 draws a leading file glyph on every document row —
      the accent duotone on its pinned cards, the neutral one
      on the recent list. Web has no pin field, so every row
      takes the neutral variant.
    */}
      <DocumentsGlyph className="hidden h-4 w-4 shrink-0 text-muted sm:block" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{doc.title}</p>
        {/*
        Description LAST, and the order is load-bearing. The
        merged line is `truncate`, where the two lines it
        replaced were not: the meta line wrapped and the
        description had its own `line-clamp-1`. So whatever
        leads this string is what survives a narrow row — and
        with the description first, one ordinary sentence ate
        the upload date, the folder, the type and the effective
        date, none of which had ever been able to disappear
        before. The structured fields are short, bounded and
        the ones a member scans by; the description is the
        free-text field and the right thing to lose to an
        ellipsis.
      */}
        <p className="truncate text-caption text-muted">
          {[
            labelled("Uploaded", formatDay(doc.created_at)),
            doc.folder,
            doc.document_type,
            labelled("Effective", formatDay(doc.effective_date)),
            doc.description,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:ml-auto">
        <DownloadButton id={doc.id} title={doc.title} />
        <Can permission="chapter_docs:manage">
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
        </Can>
      </div>
    </li>
  );
}
