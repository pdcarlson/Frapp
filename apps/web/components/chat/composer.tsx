"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import { Paperclip, Send, Smile, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRequestChatUploadUrl, useUploadSignedUrl } from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { EmojiPicker } from "./emoji-picker";
import { SlashPalette } from "./slash-palette";
import {
  parseSlashInput,
  type SlashCommand,
} from "@repo/chat-integrations";

interface ComposerProps {
  channelId: string;
  channelName: string;
  isReadOnly: boolean;
  draft: string;
  onChangeDraft: (body: string) => void;
  onSend: (body: string) => void | Promise<void>;
  onTyping: () => void;
  isModuleEnabled: (moduleKey: string) => boolean;
  disabled?: boolean;
}

/**
 * Submit on Enter; let Shift+Enter fall through to StarterKit's default
 * hard-break. Bound as a Tiptap extension so we get full ProseMirror context
 * (composition state, etc.) instead of a flaky DOM keydown. The closure
 * delegates to a ref that holds the latest submit handler, so the keymap
 * always honors the current `disabled` state without re-binding the extension.
 */
function createSubmitKeymap(onSubmit: () => void) {
  return Extension.create({
    name: "submit-on-enter",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          onSubmit();
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

/**
 * Composer: Tiptap WYSIWYG editor + slash palette + emoji insert + pre-signed
 * file upload. Drafts persist as serialized text (Tiptap → plain text) so the
 * Dexie schema stays stable across editor upgrades.
 */
export function Composer({
  channelId,
  channelName,
  isReadOnly,
  draft,
  onChangeDraft,
  onSend,
  onTyping,
  isModuleEnabled,
  disabled,
}: ComposerProps) {
  const { toast } = useToast();
  const requestUploadUrl = useRequestChatUploadUrl();
  const uploadSignedUrl = useUploadSignedUrl();
  const fileInput = useRef<HTMLInputElement | null>(null);
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
        placeholder: `Message #${channelName}`,
      }),
      createSubmitKeymap(() => sendRef.current()),
    ],
    content: buildDocFromPlainText(draft),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[40px] max-h-40 overflow-y-auto",
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

  const submit = useCallback(() => {
    if (disabled) return;
    if (!editor) return;
    const text = editor.getText().trim();
    if (text.length === 0) return;
    void onSend(text);
    // Only clear when a send was actually issued.
    editor.commands.clearContent(true);
  }, [disabled, editor, onSend]);
  sendRef.current = submit;

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
      if (!file || !editor) return;
      try {
        const response = (await requestUploadUrl.mutateAsync({
          id: channelId,
          body: { filename: file.name, content_type: file.type },
        })) as unknown as {
          signedUrl: string;
          storagePath: string;
          messageId: string;
        };
        await uploadSignedUrl.mutateAsync({
          signedUrl: response.signedUrl,
          file,
        });
        // Append the storage path as a simple text reference until Chunk 05
        // wires rich inline-attachment renderers. The hot path stays text +
        // metadata; the storage path is the durable handle.
        editor
          .chain()
          .focus()
          .insertContent(`\n📎 ${file.name} (${response.storagePath})`)
          .run();
      } catch (err) {
        toast({
          title: "Couldn't upload file",
          description:
            err instanceof Error ? err.message : "Retry in a moment.",
          variant: "destructive",
        });
      }
    },
    [channelId, editor, requestUploadUrl, toast, uploadSignedUrl],
  );

  // Cmd+/ globally inside the composer opens the palette.
  const handleHostKey = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "/" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setPalette({ open: true, query: "" });
    }
  }, []);

  const onPaletteSelect = useCallback(
    (command: SlashCommand) => {
      setPalette({ open: false, query: "" });
      toast({
        title: `/${command.name}`,
        description:
          "Slash-command renderers ship in Chunk 05. The catalog is gated by your chapter's enabled modules.",
      });
      if (editor) {
        editor.commands.clearContent(true);
      }
    },
    [editor, toast],
  );

  if (isReadOnly) {
    return (
      <div className="border-t p-3 text-xs text-muted-foreground">
        This channel is read-only. Posting requires the{" "}
        <code>announcements:post</code> permission.
      </div>
    );
  }

  const attachPending =
    requestUploadUrl.isPending || uploadSignedUrl.isPending;

  return (
    <div className="border-t p-2" onKeyDown={handleHostKey}>
      <div className="rounded-md border border-input bg-background p-2">
        <EditorContent editor={editor} />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Open emoji picker"
                >
                  <Smile className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker onPick={insertEmoji} />
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
              disabled={attachPending}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              onChange={(event) => void handleAttach(event)}
              aria-hidden="true"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Open slash commands (Cmd+/)"
              onClick={() => setPalette({ open: true, query: "" })}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Shift+Enter for a new line · Cmd+/ for slash commands
            </span>
          </div>
          <Button
            type="button"
            onClick={submit}
            disabled={disabled || !editor || editor.isEmpty}
          >
            <Send className="h-4 w-4" /> Send
          </Button>
        </div>
      </div>
      <SlashPalette
        open={palette.open}
        initialQuery={palette.query}
        isModuleEnabled={isModuleEnabled}
        onSelect={onPaletteSelect}
        onOpenChange={(open) =>
          setPalette((prev) => ({ ...prev, open, query: open ? prev.query : "" }))
        }
      />
    </div>
  );
}
