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
import Link from "next/link";
import { randomClientId, statusOf } from "@repo/api-sdk";
import {
  useAgendaSuggestionActions,
  useAgendaSuggestions,
  selectDownloadUrl,
  useDocumentDownloadUrl,
  useDocuments,
  useEventListsEditor,
  type EventLists,
} from "@repo/hooks";
import {
  AGENDA_SUGGESTION_COPY,
  agendaTabledFromLabel,
  agendaProblem,
  attachmentLinkProblem,
  attachmentLinkTitle,
  attachmentTitle,
  EVENT_AGENDA_ITEM_MAX,
  EVENT_AGENDA_MAX,
  EVENT_ATTACHMENT_TITLE_MAX,
  EVENT_ATTACHMENTS_MAX,
  moveEventEntry,
  normalizeAgendaText,
  normalizeAttachmentUrl,
  proofLinkDomain,
  toggleAgendaItem,
  type AgendaSuggestion,
  type EventAgendaItem,
  type EventAgendaTabledFrom,
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
import { useSubscriptionGate } from "@/components/shared/subscription-gate";
import { toastFailure } from "@/lib/failure-toast";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * An event's agenda and attachments on its sheet (#4934,
 * `spec/behavior/events.md` § Agenda and attachments). Everyone who can see
 * the event reads them; an `events:update` holder edits them in place, the
 * way Notion's and Fellow's meeting agendas are a checklist on the meeting
 * itself rather than a field in a form. Both lists share one editor
 * (`useEventListsEditor`), so a run of quick changes goes out as one save
 * of this meeting's whole lists, never the series'.
 */

const SECTION = "grid gap-2 rounded-lg border border-border p-3";
const LABEL = "text-caption text-muted-foreground";

/** Whether Chapter Files is on: `null` while the module read can't say. */
export type DocumentsModule = boolean | null;

export function EventMeetingLists({
  eventId,
  lists,
  canEdit,
  upcoming,
  documentsOn,
}: {
  eventId: string;
  lists: EventLists;
  /** Holds `events:update`, and the event is there to write to. */
  canEdit: boolean;
  /** The meeting hasn't ended: Suggested shows only for one still to come. */
  upcoming: boolean;
  documentsOn: DocumentsModule;
}) {
  // A paid write, like the sheet's Edit: a lapsed chapter or an offline
  // browser reads the lists but gets no controls that would only be refused.
  const gate = useSubscriptionGate();
  const editable = canEdit && gate.allowed;
  const editor = useEventListsEditor(eventId, lists, {
    onFailed: (error) =>
      toastFailure({
        title: "Couldn't save the agenda or attachments",
        error,
        fallback: "Your last change was undone. Try it again in a moment.",
      }),
  });
  return (
    <>
      <EventAgendaSection
        agenda={editor.agenda}
        canEdit={editable}
        onChange={(update) => editor.change("agenda", update)}
      />
      {editable && upcoming ? (
        <AgendaSuggestions
          eventId={eventId}
          full={editor.agenda.length >= EVENT_AGENDA_MAX}
          flushAgenda={editor.flush}
        />
      ) : null}
      <EventAttachmentsSection
        attachments={editor.attachments}
        canEdit={editable}
        documentsOn={documentsOn}
        onChange={(update) => editor.change("attachments", update)}
      />
    </>
  );
}

export function EventAgendaSection({
  agenda,
  canEdit,
  onChange,
}: {
  agenda: EventAgendaItem[];
  canEdit: boolean;
  onChange: (update: (current: EventAgendaItem[]) => EventAgendaItem[]) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  if (agenda.length === 0 && !canEdit) return null;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = normalizeAgendaText(draft);
    if (!text) return;
    const problem = agendaProblem([...agenda, { text }]);
    if (problem) {
      toast({ title: "Couldn't add that item", description: problem });
      return;
    }
    setDraft("");
    onChange((current) => [
      ...current,
      { id: randomClientId(), text, done: false },
    ]);
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
                      onChange((current) => toggleAgendaItem(current, item.id))
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
                {!canEdit && item.done ? (
                  <span className="sr-only">Done: </span>
                ) : null}
                {item.text}
                {item.tabled_from ? (
                  <TabledFromLink from={item.tabled_from} />
                ) : null}
              </span>
              {canEdit ? (
                <span className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                  <IconButton
                    label={`Move "${item.text}" up`}
                    disabled={index === 0}
                    onClick={() =>
                      onChange((current) =>
                        moveEventEntry(
                          current,
                          current.findIndex((entry) => entry.id === item.id),
                          -1,
                        ),
                      )
                    }
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move "${item.text}" down`}
                    disabled={index === agenda.length - 1}
                    onClick={() =>
                      onChange((current) =>
                        moveEventEntry(
                          current,
                          current.findIndex((entry) => entry.id === item.id),
                          1,
                        ),
                      )
                    }
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove "${item.text}"`}
                    onClick={() =>
                      onChange((current) =>
                        current.filter((entry) => entry.id !== item.id),
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
        <form onSubmit={add} className="flex items-center gap-2">
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

/**
 * "Tabled from Tuesday, November 11 · 2nd time" under an agenda item or a
 * suggestion (#5534), linking to the minutes of that day. Everyone who sees
 * the agenda sees it; the minutes themselves open only for their audience.
 */
function TabledFromLink({ from }: { from: EventAgendaTabledFrom }) {
  const label = agendaTabledFromLabel(from);
  if (!label) return null;
  return (
    <Link
      href={`/meetings/${from.meeting_id}`}
      className={cn(
        "block w-fit rounded-sm text-caption text-muted-foreground no-underline hover:underline",
        FOCUS_RING_OFFSET,
      )}
    >
      {label}
    </Link>
  );
}

/**
 * Suggested agenda items (#5534, `spec/behavior/events.md` § Suggested
 * agenda items) under the agenda, for whoever can edit it: what earlier
 * meetings with the same people tabled, first, then what the model
 * suggests. Each row has Add and Dismiss, the way Fellow suggests talking
 * points under a meeting's agenda and Linear offers suggested labels: one
 * tap takes it, one tap waves it off. Nothing shows when there's nothing
 * to suggest.
 */
function AgendaSuggestions({
  eventId,
  full,
  flushAgenda,
}: {
  eventId: string;
  full: boolean;
  flushAgenda: () => Promise<void>;
}) {
  const list = useAgendaSuggestions(eventId);
  const actions = useAgendaSuggestionActions(eventId, { flushAgenda });
  const [busy, setBusy] = useState<string | null>(null);

  if (list.suggestions.length === 0 && !list.writing) return null;

  async function act(row: AgendaSuggestion, action: "add" | "dismiss") {
    setBusy(row.id);
    try {
      await actions[action](row.id);
    } catch (error) {
      toastFailure({
        title:
          action === "add"
            ? "Couldn't add that to the agenda"
            : "Couldn't dismiss that suggestion",
        error,
        fallback: "Try again in a moment.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label={AGENDA_SUGGESTION_COPY.heading} className={SECTION}>
      <div className="flex items-center justify-between gap-2">
        <p className={LABEL}>{AGENDA_SUGGESTION_COPY.heading}</p>
        {list.aiAvailable && !list.writing ? (
          <button type="button" className={QUIET_LINK} onClick={list.refresh}>
            {AGENDA_SUGGESTION_COPY.refresh}
          </button>
        ) : null}
      </div>
      {list.suggestions.length > 0 ? (
        <ul className="grid gap-1">
          {list.suggestions.map((row) => (
            <li
              key={row.id}
              className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11"
            >
              <span className="min-w-0 flex-1 break-words text-sm">
                {row.text}
                {row.tabled_from ? (
                  <TabledFromLink from={row.tabled_from} />
                ) : row.reason ? (
                  <span className="block text-caption text-muted-foreground">
                    {row.reason}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={full || busy !== null}
                aria-label={AGENDA_SUGGESTION_COPY.addLabel(row.text)}
                onClick={() => void act(row, "add")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {AGENDA_SUGGESTION_COPY.add}
              </Button>
              <IconButton
                label={AGENDA_SUGGESTION_COPY.dismissLabel(row.text)}
                disabled={busy !== null}
                onClick={() => void act(row, "dismiss")}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {list.writing ? (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {AGENDA_SUGGESTION_COPY.writing}
        </p>
      ) : null}
      {full && list.suggestions.length > 0 ? (
        <p className="text-caption text-muted-foreground">
          The agenda is full ({EVENT_AGENDA_MAX} items). Remove one to add a
          suggestion.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Open a Chapter Files document to read, in a new tab (the inline signed
 * link, not the forced download). A file deleted since it was attached says
 * so rather than failing generically.
 */
function useOpenDocument() {
  const signedLinks = useDocumentDownloadUrl();
  const { toast } = useToast();
  const [openingId, setOpeningId] = useState<string | null>(null);
  async function open(documentId: string) {
    setOpeningId(documentId);
    try {
      const url = selectDownloadUrl(await signedLinks.mutateAsync(documentId));
      if (!url) throw new Error("No link to the file came back.");
      window.open(url, "_blank", "noopener");
    } catch (error) {
      if (statusOf(error) === 404) {
        toast({
          title: "This file is gone from Chapter Files",
          description: "Someone removed it after it was attached.",
        });
      } else {
        toastFailure({
          title: "Couldn't open that file",
          error,
          fallback: "Try again in a moment.",
        });
      }
    } finally {
      setOpeningId(null);
    }
  }
  return { open, openingId };
}

export function EventAttachmentsSection({
  attachments,
  canEdit,
  documentsOn,
  onChange,
}: {
  attachments: EventAttachment[];
  canEdit: boolean;
  documentsOn: DocumentsModule;
  onChange: (update: (current: EventAttachment[]) => EventAttachment[]) => void;
}) {
  const { open, openingId } = useOpenDocument();
  const [adding, setAdding] = useState<"link" | "document" | null>(null);
  if (attachments.length === 0 && !canEdit) return null;

  const full = attachments.length >= EVENT_ATTACHMENTS_MAX;
  const attachedDocuments = new Set(
    attachments.flatMap((a) => (a.kind === "document" ? [a.document_id] : [])),
  );
  const add = (attachment: EventAttachment) => {
    onChange((current) =>
      current.length >= EVENT_ATTACHMENTS_MAX
        ? current
        : [...current, attachment],
    );
    setAdding(null);
  };

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
                  // Only a module read that answered "off" disables it; one
                  // that can't say yet lets the server answer.
                  disabled={documentsOn === false || openingId !== null}
                  onClick={() => void open(attachment.document_id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-sm hover:underline disabled:no-underline",
                    FOCUS_RING_OFFSET,
                  )}
                >
                  {openingId === attachment.document_id ? (
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
                    {documentsOn === false
                      ? "Chapter Files is off"
                      : "Chapter Files"}
                  </span>
                </button>
              )}
              {canEdit ? (
                <IconButton
                  label={`Remove "${attachment.title}"`}
                  onClick={() =>
                    onChange((current) =>
                      current.filter((entry) => entry.id !== attachment.id),
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
          onAdd={(url, title) =>
            add({ id: randomClientId(), kind: "link", url, title })
          }
        />
      ) : null}
      {canEdit && !full && adding === "document" ? (
        <PickDocument
          attached={attachedDocuments}
          onCancel={() => setAdding(null)}
          onPick={(documentId, title) =>
            add({
              id: randomClientId(),
              kind: "document",
              document_id: documentId,
              title: attachmentTitle(title),
            })
          }
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
          {documentsOn === true ? (
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
  onAdd: (url: string, title: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const urlId = useId();
  const titleId = useId();
  const problemId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const refused = attachmentLinkProblem(url);
    const normalized = normalizeAttachmentUrl(url);
    if (refused || !normalized) {
      setProblem(refused ?? "Paste a web address.");
      return;
    }
    onAdd(normalized, attachmentLinkTitle(title, normalized));
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
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
        <Button type="submit" size="sm" disabled={!url.trim()}>
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
  onPick: (documentId: string, title: string) => void;
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
                onClick={() => onPick(doc.id, doc.title)}
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
