/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { FrappThemeProvider } from "@/lib/theme";
import type { ChatMessage } from "@repo/chat-core/types";
import { SignupCard } from "./signup-card";

const myPermissions = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useMyPermissions: () => ({ data: { permissions: myPermissions.current } }),
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#DDB844",
    accentPrimary: "#DDB844",
    accentOnPrimary: "#292109",
  }),
}));

const names: Record<string, string> = { u1: "Devin Okafor" };

function card(
  claims: { user: string; slots: string[]; note?: string }[],
  extra: Record<string, unknown> = {},
): ChatMessage {
  return {
    id: "m1",
    channel_id: "c1",
    sender_id: "u9",
    content: "Sober drivers",
    kind: "signup",
    _status: "confirmed",
    reactions: [],
    sender_blocked: false,
    _blockEvaluated: true,
    payload: {
      title: "Sober drivers",
      slots: [
        { id: "fri", label: "Friday", capacity: 1 },
        { id: "sat", label: "Saturday", capacity: null },
      ],
      ...extra,
    },
    actions: claims.map((claim, i) => ({
      id: `a${i}`,
      message_id: "m1",
      user_id: claim.user,
      action_type: "signup",
      payload: {
        slot_ids: claim.slots,
        ...(claim.note ? { note: claim.note } : {}),
      },
      created_at: `2026-11-12T10:0${i}:00Z`,
    })),
  } as unknown as ChatMessage;
}

function render(
  message: ChatMessage,
  onClaim = vi.fn(),
  onCloseSignup?: (id: string) => void,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SignupCard
          message={message}
          viewerId="me"
          isConfirmed
          nameFor={(id) => names[id] ?? null}
          onClaim={onClaim}
          onCloseSignup={onCloseSignup}
          onRetry={vi.fn()}
          onDiscard={vi.fn()}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  );

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

describe("SignupCard on the phone (#3926)", () => {
  it("names who holds each slot and holds back a full one", () => {
    const tree = render(card([{ user: "u1", slots: ["fri"] }]));
    expect(text(tree)).toContain("Devin Okafor");
    // Full and not the viewer's: the row says so in place of its count.
    expect(text(tree)).toContain("Full");
    expect(text(tree)).not.toContain("1/1");
    expect(button(tree, "Full: Friday").props.disabled).toBe(true);
    // An empty slot's count is the whole story; no "no one yet" line.
    expect(text(tree)).not.toContain("no one yet");
  });

  it("puts You first among a slot's holders and takes a tap to give it up", () => {
    const onClaim = vi.fn();
    const tree = render(
      card([
        { user: "u1", slots: ["sat"] },
        { user: "me", slots: ["sat"] },
      ]),
      onClaim,
    );
    expect(text(tree)).toContain("You and Devin Okafor");
    act(() => button(tree, "Signed up: Saturday").props.onPress());
    expect(onClaim).toHaveBeenCalledWith("m1", "signup", { slot_ids: [] });
  });

  it("sends the viewer's whole list on a tap, as web's card does", () => {
    const onClaim = vi.fn();
    const tree = render(card([]), onClaim);
    act(() => button(tree, "Sign up: Saturday").props.onPress());
    expect(onClaim).toHaveBeenCalledWith("m1", "signup", { slot_ids: ["sat"] });
  });

  const headcount = {
    format: "headcount",
    slots: [
      { id: "going", label: "Going", capacity: null },
      { id: "not_going", label: "Can’t make it", capacity: null },
    ],
  };

  it("answers a headcount and shows each answer's note", () => {
    const onClaim = vi.fn();
    const tree = render(
      card([{ user: "u1", slots: ["going"], note: "late" }], headcount),
      onClaim,
    );
    expect(text(tree)).toContain("Headcount · 1 going");
    expect(text(tree)).toContain("late");
    act(() => button(tree, "Answer: Going").props.onPress());
    expect(onClaim).toHaveBeenCalledWith("m1", "signup", {
      slot_ids: ["going"],
    });
  });

  it("takes no taps once closed, and offers Close to a moderator while open", () => {
    // A moderator viewing: only the closing hides Close.
    myPermissions.current = ["channels:manage"];
    const closed = render(
      card([{ user: "u1", slots: ["fri"] }], {
        closed_at: "2026-11-12T09:00:00Z",
      }),
      vi.fn(),
      vi.fn(),
    );
    expect(text(closed)).toContain("Sign-up · Closed");
    expect(text(closed)).toContain("Devin Okafor");
    // Its rows stay, as a closed poll's options do, and take no taps.
    expect(button(closed, "Sign up: Saturday").props.disabled).toBe(true);
    expect(() => button(closed, "Close sign-ups")).toThrow();

    myPermissions.current = ["channels:manage"];
    const onClose = vi.fn();
    const open = render(card([]), vi.fn(), onClose);
    act(() => button(open, "Close sign-ups").props.onPress());
    expect(onClose).toHaveBeenCalledWith("m1");
    myPermissions.current = [];
  });
});
