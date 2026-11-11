"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { MentionChipTest } from "@repo/validation";
import { cn } from "@/lib/utils";
import {
  buildEditDoc,
  chatMentionExtension,
  createKeymap,
  useMentionSourceRefs,
} from "./chat-editor";

export interface InlineMessageEditorHandle {
  focus: () => void;
}

export interface InlineMessageEditorProps {
  /** The message as the server holds it. */
  value: string;
  /**
   * Which of its `@`-tokens are chips in the row (`useMentionChips`): those
   * open as chips here too, so pressing Edit changes nothing on screen.
   */
  chips?: MentionChipTest | ((token: string) => boolean);
  /**
   * Bumped by the parent to load `value` again: a newer copy of the message
   * arriving before the member has typed anything.
   */
  resetKey?: number;
  disabled?: boolean;
  onChange: (text: string) => void;
  /** Enter. Shift+Enter is a line break. */
  onSave: () => void;
  /** Escape. */
  onCancel: () => void;
  className?: string;
}

/**
 * The editor a message turns into when its author presses Edit (#2236).
 *
 * The composer's editor, minus everything an edit doesn't want (drafts, the
 * outbox, the slash palette, attachments): the same Tiptap mention extension,
 * so `@` opens the same member-and-role list and a pick inserts the same chip,
 * and every mention already in the message opens as that chip rather than
 * raw `@Name` text. It used to be a plain textarea, so an edit dropped every
 * chip, offered no list, and a tester adding a mention by hand wrote
 * `@shawn` (tester report 2026-11-11). Discord edits in the same rich box it
 * composes in.
 *
 * What it sends is still plain text (`getText`): mentions resolve server-side
 * from the `@token` body, so the wire format is unchanged.
 */
export const InlineMessageEditor = forwardRef<
  InlineMessageEditorHandle,
  InlineMessageEditorProps
>(function InlineMessageEditor(
  { value, chips, resetKey = 0, disabled, onChange, onSave, onCancel, className },
  ref,
) {
  const { rosterRef, rolesRef } = useMentionSourceRefs();
  const onChangeRef = useRef(onChange);
  const keysRef = useRef<{ Enter?: () => void; Escape?: () => void }>({});
  useEffect(() => {
    onChangeRef.current = onChange;
    keysRef.current = { Enter: onSave, Escape: onCancel };
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // A message body is one paragraph of text with line breaks: no
        // headings, lists or quotes for Enter or a markdown shortcut to make.
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      chatMentionExtension(rosterRef, rolesRef),
      createKeymap("inline-edit-keys", keysRef),
    ],
    content: buildEditDoc(value, chips),
    autofocus: "end",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Edit message",
        class: cn(
          // The §4 text input at the body column's width, growing with the
          // draft up to the composer's own cap (`max-h-40`), with the body's
          // 16 / 25 type so the draft wraps where the message did.
          "min-h-[60px] max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-input bg-background px-3 py-2 text-base leading-[25px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        ),
      },
    },
    onUpdate({ editor: current }) {
      onChangeRef.current(current.getText());
    },
    immediatelyRender: false,
  });

  // A newer copy of the message, loaded while the member hasn't typed.
  const loadedKey = useRef(resetKey);
  useEffect(() => {
    if (!editor || loadedKey.current === resetKey) return;
    loadedKey.current = resetKey;
    editor.commands.setContent(buildEditDoc(value, chips), {
      emitUpdate: false,
    });
  }, [editor, resetKey, value, chips]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useImperativeHandle(
    ref,
    () => ({ focus: () => editor?.commands.focus("end") }),
    [editor],
  );

  return <EditorContent editor={editor} />;
});
