"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { FOCUS_RING_WITHIN } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AttachGlyph,
  OfflineGlyph,
  ReactionGlyph,
  SendGlyph,
  SlashCommandGlyph,
} from "./chat-glyphs";
import { cn } from "@/lib/utils";
import { useRequestChatUploadUrl, useUploadSignedUrl } from "@repo/hooks";
import type { OutboxAttachment } from "@repo/chat-core/adapters";
import { useToast } from "@/hooks/use-toast";
import {
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  inspectUploadFile,
} from "@repo/validation";
import { EmojiPicker } from "./emoji-picker";
import { SlashPalette } from "./slash-palette";
import {
  getSlashCommand,
  parseSlashInput,
  type SlashCommand,
} from "@repo/chat-integrations";

interface ComposerProps {
  channelId: string;
  channelName: string;
  /**
   * Direct/group DM, in which case `channelName` is a person's name rather than
   * a channel and must not take the `#` sigil.
   */
  isDirect?: boolean;
  isReadOnly: boolean;
  draft: string;
  onChangeDraft: (body: string) => void;
  onSend: (
    body: string,
    attachments: OutboxAttachment[],
  ) => void | Promise<void>;
  /**
   * Invoked when the user picks a slash command from the palette. Returns a
   * dispatch result so the composer can toast on failure. The args string is
   * everything after the command token (already trimmed). The composer
   * clears its own editor on success.
   */
  onSlashDispatch?: (
    command: SlashCommand,
    args: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onTyping: () => void;
  isModuleEnabled: (moduleKey: string) => boolean;
  /**
   * Status of the underlying chapter-config query. `"loading"` and `"error"`
   * surface explicit states inside the slash palette instead of an empty
   * filter; defaults to `"ready"` for callers that don't gate the catalog.
   */
  slashCommandsStatus?: "loading" | "error" | "ready";
  onRetrySlashCommands?: () => void;
  /**
   * Realtime is down. The composer stays **live** and says so — it does not
   * disable.
   *
   * This used to be `disabled`, and it was a defect: `sendMessage` writes the
   * row to the Dexie outbox and returns *before* it touches the network
   * (`packages/chat-core/src/chat-client.ts`, which has an explicit
   * "Offline: the row is safely queued" branch), so gating the composer defeated
   * the queue built to make composing-while-offline work. `spec/ui/resilience.md`
   * §2 states the rule directly — "labeled, never blocked, wherever an outbox
   * exists" — and reserves disabling for surfaces where a failed write is lost.
   * Worse than the greyed Send: `submit()` returned early on the same flag, so
   * pressing Enter offline silently discarded what you had typed.
   */
  isOffline?: boolean;
}

/**
 * Submit on Enter; let Shift+Enter fall through to StarterKit's default
 * hard-break. Bound as a Tiptap extension so we get full ProseMirror context
 * (composition state, etc.) instead of a flaky DOM keydown. The extension
 * reads a ref that holds the latest submit handler, so the keymap always calls
 * the current one without re-binding the extension.
 */
function createSubmitKeymap(sendRef: { current: () => void }) {
  return Extension.create({
    name: "submit-on-enter",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          sendRef.current();
          return true;
        },
      };
    },
  });
}

/**
 * Build a Tiptap doc JSON from plain text so chars like `<`, `&`, and
 * newlines round-trip safely (Tiptap's `setContent(string)` would parse the
 * value as HTML and lose escapes / mangle reserved chars). Each line becomes
 * a paragraph; consecutive newlines yield empty paragraphs.
 */
function buildDocFromPlainText(text: string): JSONContent {
  if (text.length === 0) return { type: "doc", content: [] };
  const lines = text.split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line.length === 0
        ? { type: "paragraph" }
        : {
            type: "paragraph",
            content: [{ type: "text", text: line }],
          },
    ),
  };
}

/** `#` only for an actual channel — a DM's name is a person's. */
export function composerPlaceholder(channelName: string, isDirect?: boolean) {
  return isDirect ? `Message ${channelName}` : `Message #${channelName}`;
}

/**
 * Composer: Tiptap WYSIWYG editor + slash palette + emoji insert + pre-signed
 * file upload. Drafts persist as serialized text (Tiptap → plain text) so the
 * Dexie schema stays stable across editor upgrades.
 */
export function Composer({
  channelId,
  channelName,
  isDirect,
  isReadOnly,
  draft,
  onChangeDraft,
  onSend,
  onSlashDispatch,
  onTyping,
  isModuleEnabled,
  slashCommandsStatus = "ready",
  onRetrySlashCommands,
  isOffline,
}: ComposerProps) {
  const { toast } = useToast();
  const requestUploadUrl = useRequestChatUploadUrl();
  const uploadSignedUrl = useUploadSignedUrl();
  const fileInput = useRef<HTMLInputElement | null>(null);
  /**
   * Files uploaded and waiting to be claimed by the next send.
   *
   * Held here rather than in the editor document because an attachment is not
   * text. The bytes are already in the bucket by the time a chip appears — the
   * upload happens on pick — so removing a chip drops the claim, not the object;
   * an unclaimed object is swept by the storage retention pass, and that is a
   * far better failure than the old one, where the only record of the file was a
   * string the sender could edit away.
   */
  const [pending, setPending] = useState<OutboxAttachment[]>([]);

  const [palette, setPalette] = useState<{ open: boolean; query: string }>({
    open: false,
    query: "",
  });
  const sendRef = useRef<() => void>(() => {});
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Hard break stays on Shift+Enter via StarterKit defaults.
      }),
      Placeholder.configure({
        placeholder: composerPlaceholder(channelName, isDirect),
      }),
      // Tiptap registers this shortcut while constructing the editor. The
      // closure reads `sendRef.current` only on Enter, not during render.
      // eslint-disable-next-line react-hooks/refs -- Enter keymap; latest submit lives in a ref
      createSubmitKeymap(sendRef),
    ],
    content: buildDocFromPlainText(draft),
    editorProps: {
      attributes: {
        // `prose prose-sm` used to lead this list and did nothing at all —
        // `@tailwindcss/typography` is not installed in this app or in the
        // shared preset, so both classes compiled to no rules.
        class:
          "min-h-[40px] max-h-40 overflow-y-auto text-base leading-[25px] focus:outline-none",
        "aria-label": "Message composer",
      },
    },
    onUpdate({ editor }) {
      const text = editor.getText();
      onChangeDraft(text);
      onTyping();
      const parsed = parseSlashInput(text);
      const opensPalette =
        parsed.isSlash && (parsed.command == null || parsed.command.length <= 24);
      if (opensPalette) {
        setPalette((prev) =>
          prev.open && prev.query === (parsed.command ?? "")
            ? prev
            : { open: true, query: parsed.command ?? "" },
        );
      } else {
        // Composer text is no longer a slash invocation (user backspaced the
        // leading `/`, or typed a too-long token). Close the palette so it
        // doesn't trap the user behind a stale list.
        setPalette((prev) =>
          prev.open ? { open: false, query: "" } : prev,
        );
      }
    },
    immediatelyRender: false,
  });

  // Keep the editor in sync if the draft is restored from Dexie after mount.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getText();
    if (current === draft) return;
    editor.commands.setContent(buildDocFromPlainText(draft), {
      emitUpdate: false,
    });
  }, [draft, editor]);

  // Radix's default `onCloseAutoFocus` returns focus to whatever rendered
  // `<DialogTrigger>` — this palette has none, since it opens from typing "/"
  // as often as from clicking the toolbar button, so that handler is a no-op
  // here and focus was landing nowhere (effectively `document.body`) on every
  // close. The composer editor is the one place a member always means to end
  // up, whichever of open/select/Escape/backspace-the-slash closed it.
  const paletteWasOpen = useRef(palette.open);
  useEffect(() => {
    if (paletteWasOpen.current && !palette.open) {
      editor?.commands.focus();
    }
    paletteWasOpen.current = palette.open;
  }, [palette.open, editor]);

  // Staged attachments are per-channel and need no separate reset: `pending`
  // (above) already starts `[]` via `useState`, and `chat-shell.tsx` keys
  // `<Composer>` on the channel (id + resolved name, per #1014), so a channel
  // switch always unmounts this instance rather than changing `channelId` on
  // a live one. `channelId` is therefore effectively immutable for the
  // lifetime of one Composer instance — nothing here needs to react to it
  // changing, because it never does.

  const submit = useCallback(() => {
    if (!editor) return;
    const text = editor.getText().trim();
    // An attachment-only message is a real message. Returning early on empty
    // text would have been correct while the filename WAS the text; now that a
    // file travels beside the body it would silently swallow the send.
    if (text.length === 0 && pending.length === 0) return;
    // If the message begins with an implemented slash command and a dispatch
    // is wired, route through dispatch instead of sending as plain text — so
    // Enter on `/poll "Q?" A B` posts a poll card, not a text bubble.
    const parsed = parseSlashInput(text);
    if (parsed.isSlash && parsed.command && onSlashDispatch) {
      const command = getSlashCommand(parsed.command);
      if (command?.implemented) {
        // A slash command is NOT a queued write. `/points`, `/task` and
        // `/event` POST straight to their controllers from
        // `packages/chat-core/src/dispatch.ts` with no outbox behind them, so
        // resilience.md §2's split applies within this one control: the text
        // path is labelled and stays live because it queues, and the queueless
        // path refuses and says why. Refusing *before* `clearContent` is the
        // load-bearing half — the command text survives to be re-sent.
        if (isOffline) {
          toast({
            title: `/${command.name} needs a connection`,
            description:
              "Slash commands aren't queued. Your text is still here — send it when you're back online.",
            variant: "destructive",
          });
          return;
        }
        // A slash command posts a card, which has nowhere to hang a file. Refuse
        // rather than dispatch and drop the staged attachments on the floor —
        // the same reason the offline branch above refuses instead of clearing.
        if (pending.length > 0) {
          toast({
            title: `/${command.name} can't carry attachments`,
            description:
              "Remove the attached file, or send it as its own message first.",
            variant: "destructive",
          });
          return;
        }
        editor.commands.clearContent(true);
        void (async () => {
          const result = await onSlashDispatch(command, parsed.args);
          if (!result.ok) {
            toast({
              title: `/${command.name} failed`,
              description: result.error ?? "Couldn't run that command.",
              variant: "destructive",
            });
          }
        })();
        return;
      }
    }
    void onSend(text, pending);
    // Only clear when a send was actually issued.
    editor.commands.clearContent(true);
    setPending([]);
  }, [editor, isOffline, onSend, onSlashDispatch, pending, toast]);
  useLayoutEffect(() => {
    sendRef.current = submit;
  }, [submit]);

  const insertEmoji = useCallback(
    (emoji: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(emoji).run();
    },
    [editor],
  );

  const handleAttach = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const inspected = inspectUploadFile("document", file);
      if (!inspected.ok) {
        toast({
          title:
            inspected.reason === "size"
              ? "File too large"
              : "File type not allowed",
          description:
            inspected.reason === "size"
              ? `Attachments can be up to ${MAX_UPLOAD_LABEL}.`
              : "Chat accepts PDFs, Office files, text, CSV, and common images (no SVG).",
          variant: "destructive",
        });
        return;
      }
      try {
        const response = (await requestUploadUrl.mutateAsync({
          id: channelId,
          body: { filename: file.name, content_type: inspected.contentType },
        })) as unknown as {
          signedUrl: string;
          storagePath: string;
          messageId: string;
        };
        await uploadSignedUrl.mutateAsync({
          signedUrl: response.signedUrl,
          file,
        });
        // A pending chip, not text spliced into the body. The old behaviour
        // appended `📎 <name> (<storagePath>)` into the Tiptap document, which
        // made the message body the ONLY record that the object existed: nothing
        // linked it to the message, so it could not be rendered, listed, or
        // cleaned up on delete, and a member could edit the sigil out and orphan
        // the file. The path now travels beside the body and becomes a
        // `chat_message_attachments` row server-side.
        setPending((current) => [
          ...current,
          {
            storagePath: response.storagePath,
            filename: file.name,
            contentType: inspected.contentType,
            byteSize: file.size,
          },
        ]);
      } catch (err) {
        toast({
          title: "Couldn't upload file",
          description:
            err instanceof Error ? err.message : "Retry in a moment.",
          variant: "destructive",
        });
      }
    },
    [channelId, requestUploadUrl, toast, uploadSignedUrl],
  );

  // Cmd+/ globally inside the composer opens the palette.
  const handleHostKey = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "/" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setPalette({ open: true, query: "" });
    }
  }, []);

  const onPaletteSelect = useCallback(
    async (command: SlashCommand) => {
      setPalette({ open: false, query: "" });
      // Implemented commands route through dispatch; unimplemented ones keep
      // the "coming soon" toast so the Chunk 10 stubs still surface intent.
      if (!command.implemented || !onSlashDispatch) {
        toast({
          title: `/${command.name}`,
          description:
            "This command will ship in a later chunk. The catalog is gated by your chapter's enabled modules.",
        });
        if (editor) editor.commands.clearContent(true);
        return;
      }
      const text = editor?.getText() ?? "";
      const parsed = parseSlashInput(text);
      const args = parsed.command === command.name ? parsed.args : "";
      // Clear the composer optimistically — the dispatch enqueues the message
      // through the same hot path as `onSend`, so the optimistic card appears
      // immediately and a toast surfaces any parse / authz failure.
      if (editor) editor.commands.clearContent(true);
      const result = await onSlashDispatch(command, args);
      if (!result.ok) {
        toast({
          title: `/${command.name} failed`,
          description: result.error ?? "Couldn't run that command.",
          variant: "destructive",
        });
      }
    },
    [editor, onSlashDispatch, toast],
  );

  if (isReadOnly) {
    return (
      <p className="border-t border-border px-4 py-3 text-[12.5px] text-muted-foreground">
        This channel is read-only. Posting requires the{" "}
        <code className="font-mono">announcements:post</code> permission.
      </p>
    );
  }

  const attachPending =
    requestUploadUrl.isPending || uploadSignedUrl.isPending;

  return (
    <div className="border-t border-border p-3" onKeyDown={handleHostKey}>
      {/*
        The well is `--surface-1` on the thread's `--background`, per the s05
        composer — one step up from the floor it sits on, which is how elevation
        reads on a shadowless surface. It used to be `bg-background` inside a
        `--card` pane, i.e. a step *down* from its own container.

        The ring lives here rather than on the editor: ProseMirror's node sets
        `focus:outline-none` and, before this, nothing replaced it, so the
        composer had no visible focus indicator at all.
      */}
      <div
        className={cn(
          "rounded-md border border-input bg-surface-1 p-2 transition-colors",
          FOCUS_RING_WITHIN,
        )}
      >
        {pending.length > 0 ? (
          <ul
            className="mb-2 flex flex-wrap gap-1.5"
            aria-label={`${pending.length} file${pending.length === 1 ? "" : "s"} attached`}
          >
            {pending.map((attachment) => (
              <li
                key={attachment.storagePath}
                className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface-2 py-1 pl-2 pr-1 text-[12.5px]"
              >
                <AttachGlyph className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{attachment.filename}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 shrink-0"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setPending((current) =>
                      current.filter(
                        (row) => row.storagePath !== attachment.storagePath,
                      ),
                    )
                  }
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <EditorContent editor={editor} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open emoji picker"
                >
                  <ReactionGlyph className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker onPick={insertEmoji} />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
              disabled={attachPending}
            >
              <AttachGlyph className="h-5 w-5" />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept={acceptAttribute("document")}
              className="sr-only"
              onChange={(event) => void handleAttach(event)}
              aria-hidden="true"
            />
            {/*
              Not a ✦. The four-pointed sparkle is the Ask/AI mark and
              components.md §11 says it "MUST NOT mark anything that is not an
              Ask/AI entry point or answer" — a slash palette is a command
              launcher, not an answer surface.
            */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open slash commands (Command Slash)"
              aria-haspopup="dialog"
              aria-expanded={palette.open}
              onClick={() => setPalette({ open: true, query: "" })}
            >
              <SlashCommandGlyph className="h-5 w-5" />
            </Button>
            <span className="hidden text-[12.5px] text-muted-foreground sm:inline">
              Shift+Enter for a new line · Cmd+/ for slash commands
            </span>
          </div>
          <Button
            type="button"
            onClick={submit}
            /* An attached file is enough to send: an empty editor with a staged
               attachment is a real message, and `submit` accepts it. */
            disabled={!editor || (editor.isEmpty && pending.length === 0)}
          >
            <SendGlyph className="h-5 w-5" /> Send
          </Button>
        </div>
      </div>
      {/*
        The offline label is deliberately NOT a live region. `ReconnectPill` in
        the same header already announces the connection change from the same
        `channel.connection` source, and `OfflineBanner` announces it again from
        the root layout — three polite regions would read one event three times.
        This is the label beside the control, which is what resilience.md §2 asks
        the queued surface to carry.
      */}
      {isOffline ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <OfflineGlyph className="h-4 w-4 shrink-0" />
          You&rsquo;re offline — messages send when you reconnect.
        </p>
      ) : null}
      <SlashPalette
        open={palette.open}
        initialQuery={palette.query}
        onQueryChange={(query) =>
          setPalette((prev) => ({ ...prev, query }))
        }
        isModuleEnabled={isModuleEnabled}
        status={slashCommandsStatus}
        onRetry={onRetrySlashCommands}
        onSelect={onPaletteSelect}
        onOpenChange={(open) =>
          setPalette((prev) => ({ ...prev, open, query: open ? prev.query : "" }))
        }
      />
    </div>
  );
}
