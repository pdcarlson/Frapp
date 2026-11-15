import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * The member's Can't make it? link on Event details: the chat card's link
 * arrives with `excuse=1`, which opens the line on arrival (#4660). The rule
 * itself is `myExcuseView`'s, run for real here.
 */

let mine: unknown = { excuse: null, receiver: null };
const editExcuse = vi.fn(async () => ({}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useMyEventExcuse: () => ({ data: mine }),
  useEditEventExcuse: () => ({ mutateAsync: editExcuse, isPending: false }),
  useMyAttendance: () => ({ data: { attendance: null } }),
  useSendEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWithdrawEventExcuse: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#C49A3A",
    accentPrimary: "#C49A3A",
    accentOnPrimary: "#2B2009",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: null,
  }),
}));

import { MyExcuse } from "./event-excuses";

function render(startWriting?: boolean): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MyExcuse
          eventId="evt-1"
          required
          start="2026-11-15T23:00:00.000Z"
          end="2026-11-16T00:00:00.000Z"
          opensMinutes={10}
          now={new Date("2026-11-13T12:00:00.000Z")}
          startWriting={startWriting}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("MyExcuse", () => {
  beforeEach(() => {
    mine = { excuse: null, receiver: null };
    editExcuse.mockClear();
  });

  it("opens the line on arrival from the chat card (#4660)", () => {
    expect(render(true).root.findAllByType(TextInput)).toHaveLength(1);
  });

  it("waits for Can't make it otherwise", () => {
    expect(render().root.findAllByType(TextInput)).toHaveLength(0);
  });

  it("offers it as a quiet underlined link that keeps a 44pt target (#4933)", () => {
    const tree = render();
    const link = tree.root
      .findAllByType(Pressable)
      .find(
        (node) =>
          node.props.accessibilityHint === "Send an excuse for this event.",
      );
    expect(link).toBeDefined();
    expect(link!.props.accessibilityRole).toBe("button");
    const box = StyleSheet.flatten(link!.props.style({ pressed: false }));
    expect(box.minHeight).toBeGreaterThanOrEqual(44);
    expect(box.minWidth).toBeGreaterThanOrEqual(44);
    expect(box.borderWidth).toBeUndefined();
    const label = link!.findByType(Text);
    expect(label.props.children).toBe("Can't make it?");
    expect(StyleSheet.flatten(label.props.style).textDecorationLine).toBe(
      "underline",
    );
    act(() => link!.props.onPress());
    expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  });

  const sent = (status: string) => ({
    excuse: {
      id: "x-1",
      chapter_id: "c",
      event_id: "evt-1",
      user_id: "me",
      reason: "Exam review",
      status,
      decided_by: null,
      decided_at: status === "PENDING" ? null : "2026-11-13T00:00:00Z",
      created_at: "2026-11-12T00:00:00Z",
      updated_at: "2026-11-12T00:00:00Z",
    },
    receiver: { user_id: "jake", display_name: "Jake" },
  });
  const button = (tree: ReactTestRenderer, label: string) =>
    tree.root
      .findAllByType(Pressable)
      .find(
        (node) =>
          node.props.accessibilityLabel === label ||
          node.findAllByType(Text).some((t) => t.props.children === label),
      );

  it("draws a sent excuse as one row, not a card, with Edit (#5115)", () => {
    mine = sent("PENDING");
    const tree = render();
    const reason = tree.root
      .findAllByType(Text)
      .find((t) => t.props.children === "Exam review");
    expect(reason!.props.numberOfLines).toBe(1);
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
    expect(button(tree, "Edit")).toBeDefined();
  });

  it("edits the reason in place and saves only a change", async () => {
    mine = sent("PENDING");
    const tree = render();
    act(() => button(tree, "Edit")!.props.onPress());
    const input = tree.root.findByType(TextInput);
    expect(input.props.value).toBe("Exam review");
    expect(button(tree, "Save excuse")!.props.disabled).toBe(true);
    act(() => input.props.onChangeText(" Away game "));
    await act(async () => {
      button(tree, "Save excuse")!.props.onPress();
    });
    expect(editExcuse).toHaveBeenCalledWith({
      eventId: "evt-1",
      reason: "Away game",
    });
  });

  it("sends a declined excuse again from Edit", () => {
    mine = sent("DECLINED");
    const tree = render();
    act(() => button(tree, "Edit")!.props.onPress());
    expect(button(tree, "Send excuse again")).toBeDefined();
  });

  it("offers no Edit on an approved excuse, only Withdraw", () => {
    mine = sent("APPROVED");
    const tree = render();
    expect(button(tree, "Edit")).toBeUndefined();
    expect(button(tree, "Withdraw")).toBeDefined();
  });
});
