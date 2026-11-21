import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { mentionChipFilter } from "@repo/validation";
import {
  buildEditDoc,
  chatMentionExtension,
  chatText,
  chatTextKit,
  createKeymap,
  editorMentionPicks,
  pasteAsLines,
} from "./chat-editor";

// Tiptap's ProseMirror view renders no document into jsdom here (see
// composer.spec), so the document and the keys are tested on a headless
// `Editor`, and the field the row shows on a captured `useEditor` call.
const { captured, fake } = vi.hoisted(() => ({
  captured: [] as Array<{
    extensions: Array<{ name?: string }>;
    content: unknown;
    editorProps?: { attributes?: Record<string, string> };
    onUpdate?: (props: { editor: { getText: (o?: unknown) => string } }) => void;
  }>,
  /** What the stubbed `useEditor` hands back; null is "not mounted yet". */
  fake: { current: null as unknown },
}));
vi.mock("@tiptap/react", async () => {
  const actual =
    await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: (options: (typeof captured)[number]) => {
      captured.push(options);
      return fake.current;
    },
    EditorContent: () => null,
  };
});
vi.mock("@repo/hooks", () => ({
  useChapterRoster: () => ({ data: [] }),
  useMentionRoles: () => ({ data: [] }),
}));

import { InlineMessageEditor } from "./inline-message-editor";

const PAUL = { user_id: "u-paul", display_name: "Paul Carlson" };
const SHAWN = { user_id: "u-shawn", display_name: "Shawn Lee" };

/** The row's chip test for a message that pinged Paul and Shawn. */
function chipsFor(mentioned: string[]) {
  return Object.assign(
    mentionChipFilter(mentioned, { members: [PAUL, SHAWN] }),
    { names: ["Paul Carlson", "Shawn Lee"] },
  );
}

function headless(text: string, chips?: ReturnType<typeof chipsFor>) {
  return new Editor({
    extensions: [StarterKit, Mention],
    content: buildEditDoc(text, chips),
  });
}

describe("buildEditDoc", () => {
  it("opens every mention the row chips as a chip, the spaced name whole", () => {
    const doc = buildEditDoc(
      "@Paul Carlson @shawn check the chapter structure",
      chipsFor(["u-paul", "u-shawn"]),
    );
    const nodes = doc.content?.[0]?.content ?? [];
    expect(nodes.map((node) => node.type)).toEqual([
      "mention",
      "text",
      "mention",
      "text",
    ]);
    expect(nodes[0]?.attrs).toEqual({
      id: "Paul Carlson",
      label: "Paul Carlson",
    });
    expect(nodes[2]?.attrs?.label).toBe("shawn");
  });

  it("leaves a token that pinged nobody as the text it was", () => {
    const doc = buildEditDoc("@bigsigma hi @Paul", chipsFor(["u-paul"]));
    const nodes = doc.content?.[0]?.content ?? [];
    expect(nodes.map((node) => node.type)).toEqual(["text", "mention"]);
    expect(nodes[0]?.text).toBe("@bigsigma hi ");
  });

  it("gives back exactly the body it was built from", () => {
    // `getText` is what Save sends, so a round trip that changed a character
    // would rewrite the message on every edit.
    for (const body of [
      "@Paul Carlson @shawn",
      "line one\nline two\n\nafter a blank line",
      "email paul@example.com, not a mention; @Paul is",
      "<b>not html</b> & stays",
    ]) {
      const editor = headless(body, chipsFor(["u-paul", "u-shawn"]));
      expect(editor.getText()).toBe(body);
      editor.destroy();
    }
  });

  it("keeps a composer draft's line breaks with no chip test", () => {
    // The composer restores drafts through this too: one paragraph per line
    // came back from `getText` with every line break doubled.
    const editor = headless("line one\nline two\n\nafter a blank line");
    expect(editor.getText()).toBe("line one\nline two\n\nafter a blank line");
    editor.destroy();
  });

  it("is one empty paragraph for an empty body", () => {
    expect(buildEditDoc("")).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});

describe("createKeymap", () => {
  it("runs the latest handler for Enter and Escape and leaves other keys alone", () => {
    const keys = { current: { Enter: vi.fn(), Escape: vi.fn() } };
    const editor = new Editor({
      extensions: [StarterKit, createKeymap("test-keys", keys)],
      content: "<p>hello</p>",
    });
    const press = (key: string, shiftKey = false) =>
      editor.view.someProp("handleKeyDown", (handler) =>
        handler(editor.view, new KeyboardEvent("keydown", { key, shiftKey })),
      );

    expect(press("Enter")).toBe(true);
    expect(keys.current.Enter).toHaveBeenCalledTimes(1);
    // Replaced without rebuilding the editor: the keymap reads the ref.
    const later = vi.fn();
    keys.current = { Enter: later, Escape: keys.current.Escape };
    press("Enter");
    expect(later).toHaveBeenCalledTimes(1);
    expect(press("Escape")).toBe(true);
    expect(keys.current.Escape).toHaveBeenCalledTimes(1);
    // Shift+Enter is StarterKit's line break, not a save.
    press("Enter", true);
    expect(later).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});

describe("InlineMessageEditor", () => {
  beforeEach(() => {
    captured.length = 0;
    fake.current = null;
  });

  it("is a named, growing text field on the body's type, with the composer's @ list", () => {
    render(
      <InlineMessageEditor
        value="@Paul Carlson hi"
        chips={chipsFor(["u-paul"])}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const options = captured.at(-1)!;
    const attributes = options.editorProps?.attributes ?? {};
    expect(attributes["aria-label"]).toBe("Edit message");
    expect(attributes.role).toBe("textbox");
    // Grows with the draft up to the composer's cap, on the body's 25px line
    // box so the draft wraps near where the message wrapped.
    expect(attributes.class).toContain("leading-[25px]");
    expect(attributes.class).toContain("max-h-40");
    // The shared focus recipe, whose border swap carries the 3:1 contrast.
    expect(attributes.class).toContain("focus-visible:border-accent-text");
    expect(options.extensions.map((extension) => extension.name)).toContain(
      "mention",
    );
    // The row's chips open as chips.
    expect(JSON.stringify(options.content)).toContain('"type":"mention"');
  });

  it("reports what the member typed, as the text Save sends", () => {
    const onChange = vi.fn();
    render(
      <InlineMessageEditor
        value="hi"
        onChange={onChange}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const getText = vi.fn(() => "hi there");
    captured.at(-1)!.onUpdate!({ editor: { getText } });
    expect(onChange).toHaveBeenCalledWith("hi there", []);
    // A paragraph boundary is one line break, the same as a hard break.
    expect(getText).toHaveBeenCalledWith({ blockSeparator: "\n" });
  });

  it("loads a newer copy of the message, and opening it is not an edit", () => {
    const editor = {
      commands: { setContent: vi.fn(), focus: vi.fn() },
      setEditable: vi.fn(),
    };
    fake.current = editor;
    const props = {
      onChange: vi.fn(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(
      <InlineMessageEditor value="old" resetKey={0} {...props} />,
    );
    // An update event here would mark the edit dirty before a keystroke and
    // stop the newer copy below from ever loading.
    expect(editor.setEditable).toHaveBeenCalledWith(true, false);
    expect(editor.commands.setContent).not.toHaveBeenCalled();

    rerender(<InlineMessageEditor value="new" resetKey={1} {...props} />);
    expect(editor.commands.setContent).toHaveBeenCalledWith(buildEditDoc("new"), {
      emitUpdate: false,
    });
  });
});

describe("chatTextKit", () => {
  it("sends what was typed: no markdown shortcut eats its markers", () => {
    const editor = new Editor({
      extensions: [chatTextKit()],
      content: "<p></p>",
    });
    // Each of these is an input rule in a full StarterKit, which turns the
    // text into a mark or a block and drops the characters `getText` sends.
    for (const typed of ["**urgent**", "`npm ci`", "~~x~~", "- item", "# title"]) {
      editor.commands.setContent("<p></p>");
      for (const char of typed) {
        const { from, to } = editor.state.selection;
        // What a keystroke does: input rules first, then plain insertion.
        const handled = editor.view.someProp("handleTextInput", (handler) =>
          handler(editor.view, from, to, char, () =>
            editor.state.tr.insertText(char, from, to),
          ),
        );
        if (!handled) editor.commands.insertContent(char);
      }
      expect(chatText(editor)).toBe(typed);
    }
    editor.destroy();
  });
});

describe("pasteAsLines", () => {
  it("pastes lines as hard breaks, keeping blank lines, never doubling", () => {
    const editor = new Editor({
      extensions: [chatTextKit()],
      content: "<p></p>",
    });
    const slice = pasteAsLines("line one\r\nline two\n\nafter", editor.view);
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));
    expect(chatText(editor)).toBe("line one\nline two\n\nafter");
    editor.destroy();
  });
});

describe("chatMentionExtension onlyOnceTyped", () => {
  function opened(onlyOnceTyped: boolean) {
    const started = vi.fn();
    const roster = {
      current: [{ user_id: "u-shawn", display_name: "Shawn Lee", avatar_url: null }],
    };
    const extension = chatMentionExtension(roster, { current: [] }, { onlyOnceTyped });
    const original = extension.options.suggestion.render;
    const configured = extension.configure({
      suggestion: {
        ...extension.options.suggestion,
        render: () => ({ ...original?.(), onStart: started }),
      },
    });
    const editor = new Editor({
      extensions: [chatTextKit(), configured],
      content: buildEditDoc("hey @shawn"),
    });
    editor.commands.focus("end");
    const beforeTyping = started.mock.calls.length;
    editor.commands.insertContent("x");
    const afterTyping = started.mock.calls.length;
    editor.destroy();
    return { beforeTyping, afterTyping };
  }

  it("keeps the list shut on a message ending in @text until the member types", () => {
    expect(opened(true)).toEqual({ beforeTyping: 0, afterTyping: 1 });
    // The composer's list opens on the caret alone, as before.
    expect(opened(false).beforeTyping).toBe(1);
  });
});


describe("editorMentionPicks (#3835)", () => {
  function withExtension(content: unknown) {
    return new Editor({
      extensions: [
        StarterKit,
        chatMentionExtension({ current: [] }, { current: [] }),
      ],
      content: content as never,
    });
  }

  it("reads each picked member's id off the node the @ list inserted", () => {
    const editor = withExtension({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ask " },
            // What a member row's pick inserts: its row spread onto attrs.
            {
              type: "mention",
              attrs: { id: "u-paul", label: "Paul Carlson", memberId: "u-paul" },
            },
            { type: "text", text: " and " },
            // A role row's pick carries no member id.
            { type: "mention", attrs: { id: "r-1", label: "Officers" } },
          ],
        },
      ],
    });
    expect(chatText(editor)).toBe("ask @Paul Carlson and @Officers");
    expect(editorMentionPicks(editor)).toEqual([
      { user_id: "u-paul", label: "Paul Carlson" },
    ]);
  });

  it("finds none on a message opened for an edit, whose chips the server already holds picks for", () => {
    const editor = withExtension(
      buildEditDoc("@Paul Carlson hi", chipsFor(["u-paul"])),
    );
    expect(editorMentionPicks(editor)).toEqual([]);
  });
});
