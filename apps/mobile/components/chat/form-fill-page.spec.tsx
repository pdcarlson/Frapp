/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useImperativeHandle, forwardRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Alert, BackHandler } from "react-native";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChatMessage } from "@repo/chat-core/types";
import {
  FormFillPage,
  useFormFillHost,
  type FormFillState,
} from "./form-fill-page";

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useFrappClient: () => ({}),
    useQueryOnline: () => own.online,
  };
});

// The page's read of the viewer's answers. `data` is what loaded (`undefined`
// before anything did); the rest is the query's own state. `readOnOpen` is
// what the page asked the hook for.
const own = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  error: null as Error | null,
  status: "success" as "pending" | "error" | "success",
  online: true,
  fetchStatus: "idle" as "fetching" | "paused" | "idle",
  failureCount: 0,
  isFetchedAfterMount: true,
  readOnOpen: [] as boolean[],
  refetch: vi.fn(async () => {}),
}));
vi.mock("@/lib/chat/use-own-form-response", () => ({
  useOwnFormResponse: (_id: string, _enabled: boolean, readOnOpen = false) => {
    own.readOnOpen.push(readOnOpen);
    return {
      data: own.data,
      isPending: own.isPending,
      error: own.error,
      status: own.status,
      fetchStatus: own.fetchStatus,
      failureCount: own.failureCount,
      isFetchedAfterMount: own.isFetchedAfterMount,
      refetch: own.refetch,
    };
  },
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

// The creator's read of every response (#3926 step 4).
const responses = vi.hoisted(() => ({
  result: null as unknown,
  fail: null as Error | null,
}));
vi.mock("@repo/chat-core/form-responses", async () => {
  const actual = await vi.importActual<
    typeof import("@repo/chat-core/form-responses")
  >("@repo/chat-core/form-responses");
  return {
    ...actual,
    fetchFormResponses: async () => {
      if (responses.fail) throw responses.fail;
      return responses.result;
    },
  };
});

const exported = vi.hoisted(() => ({
  calls: [] as { rows: Record<string, string>[]; prefix: string }[],
  ok: true,
}));
vi.mock("@/lib/chat/share-csv", () => ({
  shareCsv: async (rows: Record<string, string>[], prefix: string) => {
    exported.calls.push({ rows, prefix });
    return exported.ok;
  },
}));

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
  own.status = "success";
  own.online = true;
  own.fetchStatus = "idle";
  own.failureCount = 0;
  own.isFetchedAfterMount = true;
  own.readOnOpen = [];
  own.refetch.mockClear();
  save.calls = [];
  save.next = null;
  responses.result = null;
  responses.fail = null;
  exported.calls = [];
  exported.ok = true;
  vi.mocked(Alert.alert).mockClear();
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

/** A host as the channel and a thread are, through the hook they share. */
type Row = { message: ChatMessage; visibility: string };
const Host = forwardRef<FormFillState, { rows: Row[] }>(function Host(
  { rows },
  ref,
) {
  const { state, message } = useFormFillHost(rows, "c1");
  useImperativeHandle(ref, () => state, [state]);
  return <FormFillPage state={state} message={message} nameFor={nameFor} />;
});

const NAMES: Record<string, string> = { u1: "Alex Kim", u2: "Sam Lee" };
const nameFor = (id: string) => NAMES[id] ?? null;

const visible = (m: ChatMessage): Row => ({
  message: m,
  visibility: "visible",
});

function setup(rows: ChatMessage[]) {
  const ref: { current: FormFillState | null } = { current: null };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree: { current: ReactTestRenderer | null } = { current: null };
  const draw = (next: (ChatMessage | Row)[]) => (
    <QueryClientProvider client={client}>
      <FrappThemeProvider>
        <Host
          ref={ref}
          rows={next.map((m) => ("visibility" in m ? m : visible(m)))}
        />
      </FrappThemeProvider>
    </QueryClientProvider>
  );
  act(() => {
    tree.current = create(draw(rows));
  });
  return {
    tree: tree.current!,
    host: () => ref.current!,
    rerender: (next: (ChatMessage | Row)[]) =>
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
    await act(async () => host().open("m1"));
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

  it("prefills the answers already sent and offers Update answers", async () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(answerField(tree).props.value).toBe("Sam");
    expect(pressable(tree, "Update answers")).toBeDefined();
  });

  it("closes when its card is deleted while open, and follows a Close form", async () => {
    const { tree, host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    rerender([form("m1", { closed_at: "2026-11-12T00:00:00Z" })]);
    expect(host().messageId).toBe("m1");
    expect(text(tree)).toContain("This form is closed.");
    expect(pressable(tree, "Send")).toBeUndefined();
    expect(answerField(tree).props.editable).toBe(false);

    rerender([form("m1", {}, { is_deleted: true })]);
    expect(host().messageId).toBeNull();
    expect(text(tree)).not.toContain("Formal housing");
  });

  it("shows a closed form's sent answers, never unsent edits", async () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    const { tree, host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Edited, never sent"));
    rerender([form("m1", { closed_at: "2026-11-12T00:00:00Z" })]);
    expect(answerField(tree).props.value).toBe("Sam");
    expect(text(tree)).toContain(
      "This form is closed. These are the answers you sent.",
    );
  });

  it("keeps the questions on screen when a reload fails after a load", async () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "x" };
    own.error = new Error("Network down");
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(text(tree)).toContain("Which room?");
    expect(text(tree)).not.toContain("Network down");
  });

  it("offers Try again when the answers never loaded", async () => {
    own.data = undefined;
    own.error = new Error("Network down");
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(text(tree)).toContain("Network down");
    expect(text(tree)).not.toContain("Which room?");
    act(() => pressable(tree, "Try again")!.props.onPress());
    expect(own.refetch).toHaveBeenCalled();
  });

  it("lets a save that lands after its page closed close nothing else", async () => {
    const { tree, host } = setup([form("m1"), form("m2")]);
    await act(async () => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Sam"));
    await act(async () => pressable(tree, "Send")!.props.onPress());
    const late = save.next!;
    await act(async () => host().open("m2"));
    await act(async () => {
      late.resolve({ answers: { q1: "Sam" }, updated_at: "x" });
    });
    expect(host().messageId).toBe("m2");
    expect(text(tree)).toContain("Spring retreat");
  });

  it("closes on Android's back button while open", async () => {
    const { host } = setup([form()]);
    await act(async () => host().open("m1"));
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

  it("holds edits and Send until the open-time read lands, then shows the newest answers", async () => {
    own.data = { answers: { q1: "Old" }, updated_at: "x" };
    own.fetchStatus = "fetching";
    own.isFetchedAfterMount = false;
    const { tree, host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    // One read, made by the query as the page mounts (#4752): no second one
    // of the page's own.
    expect(own.readOnOpen.at(-1)).toBe(true);
    expect(own.refetch).not.toHaveBeenCalled();
    expect(answerField(tree).props.editable).toBe(false);
    expect(pressable(tree, "Update answers")!.props.disabled).toBe(true);
    // Answers sent from web since land.
    own.data = { answers: { q1: "From web" }, updated_at: "y" };
    own.fetchStatus = "idle";
    own.isFetchedAfterMount = true;
    rerender([form()]);
    expect(answerField(tree).props.editable).toBe(true);
    expect(answerField(tree).props.value).toBe("From web");
    expect(text(tree)).not.toContain("offline");
  });

  it("lets the answers on screen be edited, and says why, while the open-time read waits for the network", async () => {
    own.data = { answers: { q1: "Old" }, updated_at: "x" };
    own.online = false;
    // offlineFirst: the first attempt is still out, hanging.
    own.fetchStatus = "fetching";
    own.isFetchedAfterMount = false;
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(answerField(tree).props.editable).toBe(true);
    expect(pressable(tree, "Update answers")!.props.disabled).toBe(false);
    expect(text(tree)).toContain("You're offline");
  });

  it("keeps edits made offline and shows newer answers to the rest when the read lands", async () => {
    own.data = { answers: { q1: "Old" }, updated_at: "x" };
    own.online = false;
    own.fetchStatus = "paused";
    own.failureCount = 1;
    own.isFetchedAfterMount = false;
    const { tree, host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Mine"));
    // Back online: the read is tried again with its failure count back at
    // 0, and the questions stay editable.
    own.online = true;
    own.fetchStatus = "fetching";
    own.failureCount = 0;
    rerender([form()]);
    expect(answerField(tree).props.editable).toBe(true);
    expect(text(tree)).toContain("Couldn't check for newer answers");
    // It lands: the note goes and the member's edit stays.
    own.data = { answers: { q1: "From web" }, updated_at: "y" };
    own.fetchStatus = "idle";
    own.isFetchedAfterMount = true;
    rerender([form()]);
    expect(answerField(tree).props.value).toBe("Mine");
    expect(text(tree)).not.toContain("Couldn't check");
  });

  it("doesn't say offline when a retry waits for the app's focus while online", async () => {
    own.data = { answers: { q1: "Old" }, updated_at: "x" };
    own.fetchStatus = "paused";
    own.failureCount = 1;
    own.isFetchedAfterMount = false;
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(answerField(tree).props.editable).toBe(true);
    expect(text(tree)).not.toContain("offline");
    expect(text(tree)).toContain("Couldn't check for newer answers");
  });

  it("lets the answers on screen be edited, and says why, when the open-time read fails or retries", async () => {
    own.data = { answers: { q1: "Old" }, updated_at: "x" };
    own.fetchStatus = "fetching";
    own.failureCount = 1;
    own.isFetchedAfterMount = false;
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(answerField(tree).props.editable).toBe(true);
    expect(pressable(tree, "Update answers")!.props.disabled).toBe(false);
    expect(text(tree)).toContain("Couldn't check for newer answers");
  });

  it("says the answers load once back online when none are on the phone", async () => {
    own.data = undefined;
    own.isPending = true;
    own.status = "pending";
    own.online = false;
    own.fetchStatus = "paused";
    own.isFetchedAfterMount = false;
    const { tree, host } = setup([form()]);
    await act(async () => host().open("m1"));
    expect(text(tree)).toContain("Your answers load when you're back online.");
    expect(text(tree)).not.toContain("Which room?");
  });

  it("re-reads rather than writes the cache when a save lands after the page closed", async () => {
    const { tree, host, client } = setup([form()]);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const write = vi.spyOn(client, "setQueryData");
    await act(async () => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Sam"));
    await act(async () => pressable(tree, "Send")!.props.onPress());
    const late = save.next!;
    act(() => host().close());
    await act(async () => {
      late.resolve({ answers: { q1: "Sam" }, updated_at: "x" });
    });
    expect(write).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["chat", "form-response", "m1"],
    });
  });

  it("stays open with its answers when the card only leaves the loaded rows", async () => {
    const { tree, host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    act(() => answerField(tree).props.onChangeText("Half typed"));
    // A full reconnect backfill trims older rows out of the cache.
    rerender([]);
    expect(host().messageId).toBe("m1");
    expect(answerField(tree).props.value).toBe("Half typed");
  });

  it("closes when its card is held by the block list", async () => {
    const { host, rerender } = setup([form()]);
    await act(async () => host().open("m1"));
    rerender([{ message: form(), visibility: "tombstone" }]);
    expect(host().messageId).toBeNull();
  });

  it("closes when its screen loses focus", async () => {
    const { host } = setup([form()]);
    await act(async () => host().open("m1"));
    const router = (await import("expo-router")) as unknown as {
      __blur: () => void;
    };
    act(() => router.__blur());
    expect(host().messageId).toBeNull();
  });
});

describe("FormFillPage's Responses mode (#3926 step 4)", () => {
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  beforeEach(() => {
    responses.result = {
      responses: [
        {
          user_id: "u1",
          answers: { q1: "Alex", q2: "o1" },
          created_at: "2026-11-12T10:00:00Z",
          updated_at: "2026-11-12T10:00:00Z",
        },
        {
          user_id: "u2",
          answers: { q2: "o1" },
          created_at: "2026-11-12T11:00:00Z",
          updated_at: "2026-11-12T11:00:00Z",
        },
      ],
      not_responded: ["u3"],
    };
  });

  it("summarizes each question, names who hasn't answered, and exports the rows", async () => {
    const { tree, host } = setup([form()]);
    act(() => host().open("m1", "responses"));
    await flush();
    const shown = text(tree);
    expect(shown).toContain("2 responses");
    expect(shown).toContain("Room 1");
    expect(byLabel(tree, "Room 1: 2, 100%")).toBeDefined();
    // Someone the roster can't name gets the shared fallback label.
    expect(shown).toContain("Not answered yet (1) Member u3");
    // The form's own questions are not on the Responses page as fields.
    expect(
      tree.root.findAll((n) => (n.type as unknown) === "TextInput"),
    ).toHaveLength(0);

    await act(async () => {
      pressable(tree, "Export").props.onPress();
    });
    expect(exported.calls).toHaveLength(1);
    expect(exported.calls[0]!.prefix).toBe("form-formal-housing");
    expect(exported.calls[0]!.rows.map((row) => row.Name)).toEqual([
      "Alex Kim",
      "Sam Lee",
    ]);
  });

  it("lists each person's answers on Individual", async () => {
    const { tree, host } = setup([form()]);
    act(() => host().open("m1", "responses"));
    await flush();
    act(() => byLabel(tree, "Individual").props.onPress());
    const shown = text(tree);
    expect(shown).toContain("Alex Kim");
    expect(shown).toContain("Sam Lee");
    expect(shown).toContain("No answer");
  });

  it("offers a retry when the read fails, and closes when the form is deleted", async () => {
    responses.fail = new Error("Network down");
    const { tree, host, rerender } = setup([form()]);
    act(() => host().open("m1", "responses"));
    await flush();
    expect(text(tree)).toContain("Network down");
    expect(byLabel(tree, "Try again")).toBeDefined();
    rerender([form("m1", {}, { is_deleted: true })]);
    expect(host().messageId).toBeNull();
  });

  it("holds Export until someone answers, and says so when a share fails", async () => {
    responses.result = { responses: [], not_responded: ["u1"] };
    const empty = setup([form()]);
    act(() => empty.host().open("m1", "responses"));
    await flush();
    expect(text(empty.tree)).toContain("No one has answered yet.");
    expect(pressable(empty.tree, "Export").props.disabled).toBe(true);

    responses.result = {
      responses: [
        {
          user_id: "u1",
          answers: { q1: "Alex" },
          created_at: "2026-11-12T10:00:00Z",
          updated_at: "2026-11-12T10:00:00Z",
        },
      ],
      not_responded: [],
    };
    exported.ok = false;
    const { tree, host } = setup([form()]);
    act(() => host().open("m1", "responses"));
    await flush();
    expect(pressable(tree, "Export").props.disabled).toBe(false);
    await act(async () => {
      pressable(tree, "Export").props.onPress();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      "Couldn't export",
      "Try again in a moment.",
    );
  });
});
