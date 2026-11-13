/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChatMessage } from "@repo/chat-core/types";
import { FormCard } from "./form-card";
import { FormFillContext } from "./form-fill-page";

const myPermissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMyPermissions: () => ({ data: { permissions: myPermissions.current } }),
  };
});

// The viewer's own answers: `undefined` while loading, `null` before they
// answer, a response once they have.
const own = vi.hoisted(() => ({
  data: undefined as unknown,
  enabled: [] as boolean[],
}));
vi.mock("@/lib/chat/use-own-form-response", () => ({
  useOwnFormResponse: (_id: string, enabled: boolean) => {
    own.enabled.push(enabled);
    return {
      isSuccess: own.data !== undefined,
      data: own.data,
    };
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
  myPermissions.current = [];
  own.data = null;
  own.enabled = [];
});

function form(
  extra: Record<string, unknown> = {},
  row: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u9",
    content: "Formal housing",
    kind: "form",
    _status: "confirmed",
    reactions: [],
    sender_blocked: false,
    _blockEvaluated: true,
    payload: {
      title: "Formal housing",
      description: "Pick by Friday",
      questions: [
        { id: "q1", type: "short_answer", title: "Name?", required: true },
        {
          id: "q2",
          type: "multiple_choice",
          title: "Which room?",
          required: false,
          options: [{ id: "o1", label: "Room 1" }],
        },
      ],
      ...extra,
    },
    ...row,
  } as unknown as ChatMessage;
}

function render(
  message: ChatMessage,
  {
    open = vi.fn(),
    hosted = true,
    onCloseForm,
    isConfirmed = true,
    viewerId = "me",
  }: {
    open?: (id: string) => void;
    hosted?: boolean;
    onCloseForm?: (id: string) => void;
    isConfirmed?: boolean;
    viewerId?: string;
  } = {},
): ReactTestRenderer {
  const card = (
    <FormCard
      message={message}
      viewerId={viewerId}
      isConfirmed={isConfirmed}
      onCloseForm={onCloseForm}
      onRetry={vi.fn()}
      onDiscard={vi.fn()}
      onReact={vi.fn()}
      onUnreact={vi.fn()}
    />
  );
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        {hosted ? (
          <FormFillContext.Provider value={open}>
            {card}
          </FormFillContext.Provider>
        ) : (
          card
        )}
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const buttons = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.accessibilityLabel === "string",
  );
const button = (tree: ReactTestRenderer, label: string) =>
  buttons(tree).find((node) => node.props.accessibilityLabel === label);

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

describe("FormCard on the phone (#3926 step 3)", () => {
  it("draws the title, details and question count, and opens the page on Fill out", () => {
    const open = vi.fn();
    const tree = render(form(), { open });
    const drawn = text(tree);
    expect(drawn).toContain("Form");
    expect(drawn).toContain("Formal housing");
    expect(drawn).toContain("Pick by Friday");
    expect(drawn).toContain("2 questions");
    act(() => button(tree, "Fill out")!.props.onPress());
    expect(open).toHaveBeenCalledWith("m1");
  });

  it("reads Edit your answers once the viewer has answered, and Open while it loads", () => {
    own.data = { answers: { q1: "Sam" }, updated_at: "2026-11-13T00:00:00Z" };
    expect(button(render(form()), "Edit your answers")).toBeDefined();
    own.data = undefined;
    expect(button(render(form()), "Open")).toBeDefined();
  });

  it("says Closed and offers View once the form has closed", () => {
    const tree = render(form({ closed_at: "2026-11-12T00:00:00Z" }));
    expect(text(tree)).toContain("Closed");
    expect(button(tree, "View")).toBeDefined();
  });

  it("doesn't read answers or open for a card still in the outbox", () => {
    const open = vi.fn();
    const tree = render(form({}, { _status: "pending" }), {
      open,
      isConfirmed: false,
    });
    expect(own.enabled.every((on) => on === false)).toBe(true);
    const fill = buttons(tree).find((node) =>
      ["Open", "Fill out"].includes(node.props.accessibilityLabel),
    )!;
    expect(fill.props.disabled).toBe(true);
  });

  it("offers Close form to its creator and to a channels:manage holder only", () => {
    const onCloseForm = vi.fn();
    expect(
      button(render(form(), { onCloseForm }), "Close form"),
    ).toBeUndefined();

    const mine = render(form({}, { sender_id: "me" }), { onCloseForm });
    act(() => button(mine, "Close form")!.props.onPress());
    expect(onCloseForm).toHaveBeenCalledWith("m1");

    myPermissions.current = ["channels:manage"];
    expect(button(render(form(), { onCloseForm }), "Close form")).toBeDefined();

    // Not on a form that has already closed.
    expect(
      button(
        render(form({ closed_at: "2026-11-12T00:00:00Z" }), { onCloseForm }),
        "Close form",
      ),
    ).toBeUndefined();
  });

  it("holds its button where no screen hosts the form page", () => {
    const tree = render(form(), { hosted: false });
    expect(button(tree, "Fill out")!.props.disabled).toBe(true);
  });
});
