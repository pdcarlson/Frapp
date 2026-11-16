"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Link2,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { useDocuments, useSaveEventLists } from "@repo/hooks";
import {
  agendaProblem,
  attachmentLinkTitle,
  EVENT_AGENDA_ITEM_MAX,
  EVENT_AGENDA_MAX,
  EVENT_ATTACHMENT_TITLE_MAX,
  EVENT_ATTACHMENTS_MAX,
  moveEventEntry,
  newEventEntryId,
  normalizeAgendaText,
  normalizeAttachmentUrl,
  proofLinkDomain,
  toggleAgendaItem,
  type EventAgendaItem,
  type EventAttachment,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { QUIET_LINK } from "@/components/ui/quiet-link";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useDocumentDownload } from "@/components/documents/use-document-download";
import { toastFailure } from "@/lib/failure-toast";
import { cn } from "@/lib/utils";

/**
 * An event's agenda and attachments on its sheet (#4934,
 * `spec/behavior/events.md` § Agenda and attachments). Everyone who can see
 * the event reads them; an `events:update` holder edits them in place, the
 * way Notion's and Fellow's meeting agendas are a checklist on the meeting
 * itself rather than a field in a form. Each save is this meeting's alone,
 * never the series'.
 */

const SECTION = "grid gap-2 rounded-lg border border-border p-3";
const LABEL = "text-caption text-muted-foreground";

export function EventAgendaSection({
  eventId,
  agenda,
  canEdit,
}: {
  eventId: string;
  agenda: EventAgendaItem[];
  canEdit: boolean;
}) {
  const save = useSaveEventLists(eventId);
  const [draft, setDraft] = useState("");
  const inputId = useId();
  if (agenda.length === 0 && !canEdit) return null;

  async function write(next: EventAgendaItem[], failTitle: string) {
    try {
      await save.mutateAsync({ agenda: next });
    } catch (error) {
      toastFailure({
        title: failTitle,
        error,
        fallback: "Try again in a moment.",
        retry: () => void write(next, failTitle),
      });
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = normalizeAgendaText(draft);
    if (!text) return;
    const next = [...agenda, { id: newEventEntryId(), text, done: false }];
    if (agendaProblem(next)) return;
    setDraft("");
    await write(next, "Couldn't add that item");
  }

  const full = agenda.length >= EVENT_AGENDA_MAX;

  return (
    <section aria-label="Agenda" className={SECTION}>
      <p className={LABEL}>Agenda</p>
      {agenda.length > 0 ? (
        <ol className="grid gap-1">
          {agenda.map((item, index) => (
            <li
              key={item.id}
              className="group flex min-h-9 items-center gap-2 pointer-coarse:min-h-11"
            >
              {canEdit ? (
                <label className={dashboardCheckboxHitAreaClassName}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label={item.text}
                    onChange={() =>
                      void write(
                        toggleAgendaItem(agenda, item.id),
                        "Couldn't save that check-off",
                      )
                    }
                    className={dashboardTableCheckboxClassName}
                  />
                </label>
              ) : (
                <span
                  aria-hidden="true"
                  className="w-5 shrink-0 text-center text-sm tabular-nums text-muted-foreground"
                >
                  {index + 1}.
                </span>
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 break-words text-sm",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {canEdit ? null : item.done ? (
                  <span className="sr-only">Done: </span>
                ) : null}
                {item.text}
              </span>
              {canEdit ? (
                <span className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                  <IconButton
                    label={`Move "${item.text}" up`}
                    disabled={index === 0}
                    onClick={() =>
                      void write(
                        moveEventEntry(agenda, index, -1),
                        "Couldn't move that item",
                      )
                    }
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move "${item.text}" down`}
                    disabled={index === agenda.length - 1}
                    onClick={() =>
                      void write(
                        moveEventEntry(agenda, index, 1),
                        "Couldn't move that item",
                      )
                    }
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove "${item.text}"`}
                    onClick={() =>
                      void write(
                        agenda.filter((entry) => entry.id !== item.id),
                        "Couldn't remove that item",
                      )
                    }
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {canEdit && !full ? (
        <form
          onSubmit={(event) => void add(event)}
          className="flex items-center gap-2"
        >
          <label htmlFor={inputId} className="sr-only">
            Add an agenda item
          </label>
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              agenda.length === 0 ? "Add the first item" : "Add an item"
            }
            maxLength={EVENT_AGENDA_ITEM_MAX}
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={!normalizeAgendaText(draft)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </form>
      ) : null}
      {canEdit && full ? (
        <p className="text-caption text-muted-foreground">
          An agenda holds {EVENT_AGENDA_MAX} items.
        </p>
      ) : null}
    </section>
  );
}

export function EventAttachmentsSection({
  eventId,
  attachments,
  canEdit,
  documentsOn,
}: {
  eventId: string;
  attachments: EventAttachment[];
  canEdit: boolean;
  /** Chapter Files is on, so a document can be opened and attached. */
  documentsOn: boolean;
}) {
  const save = useSaveEventLists(eventId);
  const { download, fetchingId } = useDocumentDownload();
  const [adding, setAdding] = useState<"link" | "document" | null>(null);
  if (attachments.length === 0 && !canEdit) return null;

  async function write(next: EventAttachment[], failTitle: string) {
    try {
      await save.mutateAsync({ attachments: next });
      return true;
    } catch (error) {
      toastFailure({
        title: failTitle,
        error,
        fallback: "Try again in a moment.",
      });
      return false;
    }
  }

  const full = attachments.length >= EVENT_ATTACHMENTS_MAX;
  const attachedDocuments = new Set(
    attachments.flatMap((a) => (a.kind === "document" ? [a.document_id] : [])),
  );

  return (
    <section aria-label="Attachments" className={SECTION}>
      <p className={LABEL}>Attachments</p>
      {attachments.length > 0 ? (
        <ul className="grid gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11"
            >
              {attachment.kind === "link" ? (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-sm text-sm hover:underline",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  <Link2
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{attachment.title}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {proofLinkDomain(attachment.url)}
                  </span>
                </a>
              ) : (
                <button
                  type="button"
                  disabled={!documentsOn || fetchingId !== null}
                  onClick={() => void download(attachment.document_id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm hover:underline disabled:no-underline",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  {fetchingId === attachment.document_id ? (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileText
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{attachment.title}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {documentsOn ? "Chapter Files" : "Chapter Files is off"}
                  </span>
                </button>
              )}
              {canEdit ? (
                <IconButton
                  label={`Remove "${attachment.title}"`}
                  onClick={() =>
                    void write(
                      attachments.filter((entry) => entry.id !== attachment.id),
                      "Couldn't remove that attachment",
                    )
                  }
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit && full ? (
        <p className="text-caption text-muted-foreground">
          An event holds {EVENT_ATTACHMENTS_MAX} attachments.
        </p>
      ) : null}
      {canEdit && !full && adding === "link" ? (
        <AddLinkForm
          onCancel={() => setAdding(null)}
          onAdd={async (url, title) => {
            const added = await write(
              [
                ...attachments,
                { id: newEventEntryId(), kind: "link", url, title },
              ],
              "Couldn't add that link",
            );
            if (added) setAdding(null);
          }}
        />
      ) : null}
      {canEdit && !full && adding === "document" ? (
        <PickDocument
          attached={attachedDocuments}
          onCancel={() => setAdding(null)}
          onPick={async (documentId, title) => {
            const added = await write(
              [
                ...attachments,
                {
                  id: newEventEntryId(),
                  kind: "document",
                  document_id: documentId,
                  title,
                },
              ],
              "Couldn't attach that file",
            );
            if (added) setAdding(null);
          }}
        />
      ) : null}
      {canEdit && !full && adding === null ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <button
            type="button"
            className={QUIET_LINK}
            onClick={() => setAdding("link")}
          >
            Add a link
          </button>
          {documentsOn ? (
            <button
              type="button"
              className={QUIET_LINK}
              onClick={() => setAdding("document")}
            >
              Attach from Chapter Files
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function AddLinkForm({
  onAdd,
  onCancel,
}: {
  onAdd: (url: string, title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlId = useId();
  const titleId = useId();
  const problemId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeAttachmentUrl(url);
    if (!normalized) {
      setProblem("Paste a web address starting with http:// or https://.");
      return;
    }
    setBusy(true);
    try {
      await onAdd(normalized, attachmentLinkTitle(title, normalized));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-2">
      <label htmlFor={urlId} className="sr-only">
        Link
      </label>
      <Input
        id={urlId}
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setProblem(null);
        }}
        placeholder="https://"
        inputMode="url"
        autoFocus
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? problemId : undefined}
      />
      <label htmlFor={titleId} className="sr-only">
        Title
      </label>
      <Input
        id={titleId}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title (optional)"
        maxLength={EVENT_ATTACHMENT_TITLE_MAX}
      />
      {problem ? (
        <p id={problemId} className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !url.trim()}>
          Add link
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PickDocument({
  attached,
  onPick,
  onCancel,
}: {
  attached: ReadonlySet<string>;
  onPick: (documentId: string, title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const searchId = useId();
  const documents = useDocuments();
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (documents.data ?? [])
      .filter((doc) => !attached.has(doc.id))
      .filter((doc) => !needle || doc.title.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [documents.data, search, attached]);

  return (
    <div className="grid gap-2">
      <label htmlFor={searchId} className="sr-only">
        Find a file in Chapter Files
      </label>
      <Input
        id={searchId}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Find a file in Chapter Files"
        autoFocus
      />
      {documents.isPending ? (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      ) : documents.isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load Chapter Files. Try again in a moment.
        </p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search.trim()
            ? "No file matches that."
            : "Chapter Files has nothing to attach yet. Upload it there first."}
        </p>
      ) : (
        <ul className="grid gap-1">
          {matches.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => void onPick(doc.id, doc.title)}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-card-hover pointer-coarse:min-h-11",
                  FOCUS_RING_OFFSET,
                )}
              >
                <FileText
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="truncate">{doc.title}</span>
                {doc.folder ? (
                  <span className="ml-auto shrink-0 text-caption text-muted-foreground">
                    {doc.folder}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
