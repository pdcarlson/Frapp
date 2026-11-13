/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useImperativeHandle, forwardRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BackHandler } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  FormFillPage,
  formFillLive,
  useFormFill,
  type FormFillState,
} from "./form-fill-page";

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return { ...actual, useFrappClient: () => ({}) };
});

// The page's read of the viewer's answers. `data` is what loaded (`undefined`
// before anything did); `isPending` and `error` are the query's own.
const own = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(async () => {}),
}));
vi.mock("@/lib/chat/use-own-form-response", () => ({
  useOwnFormResponse: () => ({
    data: own.data,
    isPending: own.isPending,
    error: own.error,
    refetch: own.refetch,
  }),
}));

const save = vi.hoisted(() => ({
  calls: [] as { id: string; answers: unknown }[],
  next: null as null | {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  },
}));
vi.mock("@repo/chat-core/forms", async () => {
  const actual = await vi.importActual<typeof import("@repo/chat-core/forms")>(
    "@repo/chat-core/forms",
  );
  return {
    ...actual,
    saveFormResponse: (_client: unknown, id: string, answers: unknown) => {
      save.calls.push({ id, answers });
      return new Promise((resolve, reject) => {
        save.next = { resolve, reject };
      });
    },
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#292109",
  }),
}));

beforeEach(() => {
  own.data = null;
  own.isPending = false;
  own.error = null;
  own.refetch.mockClear();
  save.calls = [];
  save.next = null;
  vi.mocked(BackHandler.addEventListener).mockClear();
});

function form(
  id = "m1",
  extra: Record<string, unknown> = {},
  row: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    channel_id: "c1",
    sender_id: "u9",
    content: "Formal housing",
    kind: "form",
    _status: "confirmed",
    reactions: [],
    payload: {
      title: id === "m1" ? "Formal housing" : "Spring retreat",
      questions: [
        { id: "q1", type: "short_answer", title: "Name?", required: true },
        {
          id: "q2",
          type: "multiple_choice",
          title: "Which room?",
          required: false,
          options: [
            { id: "o1", label: "Room 1" },
            { id: "o2", label: "Room 2" },
          ],
        },
        {
          id: "q3",
          type: "dropdown",
          title: "Shirt size?",
          required: false,
          options: [{ id: "s", label: "Small" }],
        },
      ],
      ...extra,
    },
    ...row,
  } as unknown as ChatMessage;
}

/**
 * The host as `chat-thread.tsx` is: it looks the open form's row up on every
 * render and closes the page when the row can't be answered any more.
 */
const Host = forwardRef<FormFillState, { rows: Map<string, ChatMessage> }>(
  function Host({ rows }, ref) {
    const state = useFormFill();
    useImperativeHandle(ref, () => state, [state]);
    const row = state.messageId ? rows.get(state.messageId) : undefined;
    if (state.messageId && !formFillLive(row)) state.close();
    return <FormFillPage state={state} message={row} />;
  },
);

function setup(rows: ChatMessage[]) {
  const ref: { current: FormFillState | null } = { current: null };
  const client = new QueryClient();
  const tree: { current: ReactTestRenderer | null } = { current: null };
  const draw = (next: ChatMessage[]) => (
    <QueryClientProvider client={client}>
      <FrappThemeProvider>
        <Host ref={ref} rows={new Map(next.map((m) => [m.id, m]))} />
      </FrappThemeProvider>
    </QueryClientProvider>
  );
  act(() => {
    tree.current = create(draw(rows));
  });
  return {
    tree: tree.current!,
    host: () => ref.current!,
    rerender: (next: ChatMessage[]) =>
      act(() => tree.current!.update(draw(next))),
    client,
  };
}

function text(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "children" in node)
      walk((node as { children: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(" ");
}

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((node) => node.props.accessibilityLabel === label)[0];
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      (node.props.label === label || node.props.accessibilityLabel === label),
  )[0];
const answerField = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "TextInput" &&
      String(node.props.accessibilityLabel).startsWith("Question 1"),
  );

describe("FormFillPage (#3926 step 3)", () => {
  it("draws every question with the privacy line, and sends checked answers", async () => {
    const { tree, host } = setup([form()]);
    act(() => host().open("m1"));
    const drawn = text(tree);
    expect(drawn).toContain("Formal housing");
    expect(drawn).toContain(
      "Your answers aren't posted in the chat. Only you and the person who posted this form can see them.",
    );
    expect(drawn).toContain("Which room?");
    expect(drawn).toContain("Shirt size?");

    // Send names the blank required question first, and sends nothing.
    await act(async () => pressable(tree, "Send")!.props.onPress());
    expect(save.calls).toHaveLength(0);
    expect(text(tree)).toContain("One question needs an answer.");
    expect(text(tree)).toContain("This question is required.");

    act(() => answerField(tree).props.onChangeText("  Sam "));
    act(() => byLabel(tree, "Room 2")!.props.onPress());
    await act(async () => pressable(tree, "Send")!.props.onPress());
    expect(save.calls).toEqual([
      { id: "m1", answers: { q1: "Sam", q2: "o2" } },
    ]);
    await act(async () => {
      save.next!.resolve({ answers: { q1: "Sam", q2: "o2" }, updated_at: "x" });
    });
    expect(host().messageId).toBeNull();
  });

  it("prefills the answers already sent and offers Update answers", () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    const { tree, host } = setup([form()]);
    act(() => host().open("m1"));
    expect(answerField(tree).props.value).toBe("Sam");
    expect(pressable(tree, "Update answers")).toBeDefined();
  });

  it("closes when its card is deleted while open, and follows a Close form", () => {
    const { tree, host, rerender } = setup([form()]);
    act(() => host().open("m1"));
    rerender([form("m1", { closed_at: "2026-11-12T00:00:00Z" })]);
    expect(host().messageId).toBe("m1");
    expect(text(tree)).toContain("This form is closed.");
    expect(pressable(tree, "Send")).toBeUndefined();
    expect(answerField(tree).props.editable).toBe(false);

    rerender([form("m1", {}, { is_deleted: true })]);
    expect(host().messageId).toBeNull();
    expect(text(tree)).not.toContain("Formal housing");
  });

  it("shows a closed form's sent answers, never unsent edits", () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    const { tree, host, rerender } = setup([form()]);
    act(() => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Edited, never sent"));
    rerender([form("m1", { closed_at: "2026-11-12T00:00:00Z" })]);
    expect(answerField(tree).props.value).toBe("Sam");
    expect(text(tree)).toContain(
      "This form is closed. These are the answers you sent.",
    );
  });

  it("keeps the questions on screen when a reload fails after a load", () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    own.error = new Error("Network down");
    const { tree, host } = setup([form()]);
    act(() => host().open("m1"));
    expect(text(tree)).toContain("Which room?");
    expect(text(tree)).not.toContain("Network down");
  });

  it("offers Try again when the answers never loaded", () => {
    own.data = undefined;
    own.error = new Error("Network down");
    const { tree, host } = setup([form()]);
    act(() => host().open("m1"));
    expect(text(tree)).toContain("Network down");
    expect(text(tree)).not.toContain("Which room?");
    act(() => pressable(tree, "Try again")!.props.onPress());
    expect(own.refetch).toHaveBeenCalled();
  });

  it("lets a save that lands after its page closed close nothing else", async () => {
    const { tree, host } = setup([form("m1"), form("m2")]);
    act(() => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Sam"));
    await act(async () => pressable(tree, "Send")!.props.onPress());
    const late = save.next!;
    act(() => host().open("m2"));
    await act(async () => {
      late.resolve({ answers: { q1: "Sam" }, updated_at: "x" });
    });
    expect(host().messageId).toBe("m2");
    expect(text(tree)).toContain("Spring retreat");
  });

  it("closes on Android's back button while open", () => {
    const { host } = setup([form()]);
    act(() => host().open("m1"));
    const handler = vi
      .mocked(BackHandler.addEventListener)
      .mock.calls.at(-1)?.[1] as () => boolean;
    let held = false;
    act(() => {
      held = handler();
    });
    expect(held).toBe(true);
    expect(host().messageId).toBeNull();
  });
});
