import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import { mentionChipFilter } from "@repo/validation";
import { buildEditDoc, createKeymap } from "./chat-editor";

// Tiptap's ProseMirror view renders no document into jsdom here (see
// composer.spec), so the document and the keys are tested on a headless
// `Editor`, and the field the row shows on a captured `useEditor` call.
const { captured } = vi.hoisted(() => ({
  captured: [] as Array<{
    extensions: Array<{ name?: string }>;
    content: unknown;
    editorProps?: { attributes?: Record<string, string> };
  }>,
}));
vi.mock("@tiptap/react", async () => {
  const actual =
    await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: (options: (typeof captured)[number]) => {
      captured.push(options);
      return null;
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
    expect(options.extensions.map((extension) => extension.name)).toContain(
      "mention",
    );
    // The row's chips open as chips.
    expect(JSON.stringify(options.content)).toContain('"type":"mention"');
  });
});
