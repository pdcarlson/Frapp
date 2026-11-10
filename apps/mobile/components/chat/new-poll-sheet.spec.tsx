/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import { DUPLICATE_OPTION_PROBLEM } from "@repo/chat-core/poll-draft";

/**
 * s05's New poll sheet (#3701), rendered: what it posts, when Post is held,
 * the option rows' controls, and what a failed queue leaves behind.
 */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const successHaptic = vi.fn();
vi.mock("@/lib/haptics", () => ({
  successHaptic: () => successHaptic(),
}));

import { NewPollSheet, type NewPollSheetProps } from "./new-poll-sheet";

const NOW = new Date("2026-11-09T12:00:00.000Z");

function render(
  onPost: NewPollSheetProps["onPost"],
  canCloseEarly = true,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewPollSheet
          onPost={onPost}
          canCloseEarly={canCloseEarly}
          now={() => NOW}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const field = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  );

const control = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];

const postButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label !== undefined &&
      /Post/.test(String(node.props.label)) &&
      typeof node.type === "function",
  );

function type(tree: ReactTestRenderer, label: string, text: string) {
  act(() => field(tree, label).props.onChangeText(text));
}

function fill(tree: ReactTestRenderer) {
  type(tree, "Poll question", "Who's driving Saturday?");
  type(tree, "Option 1", "Me");
  type(tree, "Option 2", "Not me");
}

const queued = () =>
  vi.fn<NewPollSheetProps["onPost"]>(async () => ({ ok: true as const }));

beforeEach(() => {
  successHaptic.mockReset();
});

describe("New poll sheet (#3701)", () => {
  it("holds Post until there's a question and two options", () => {
    const tree = render(queued());
    expect(postButton(tree).props.disabled).toBe(true);
    type(tree, "Poll question", "Who's driving?");
    type(tree, "Option 1", "Me");
    expect(postButton(tree).props.disabled).toBe(true);
    type(tree, "Option 2", "Not me");
    expect(postButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("posts the card a day out by default, then clears the draft", async () => {
    const onPost = queued();
    const tree = render(onPost);
    fill(tree);
    await act(async () => postButton(tree).props.onPress());

    expect(onPost).toHaveBeenCalledTimes(1);
    const poll = onPost.mock.calls[0]![0];
    expect(poll.content).toBe("Who's driving Saturday?");
    expect(poll.payload.question).toBe("Who's driving Saturday?");
    expect(poll.payload.options.map((o) => o.label)).toEqual(["Me", "Not me"]);
    expect(poll.payload.closes_at).toBe("2026-11-10T12:00:00.000Z");
    expect(successHaptic).toHaveBeenCalledTimes(1);
    expect(field(tree, "Poll question").props.value).toBe("");
    act(() => tree.unmount());
  });

  it("closes when More options says", async () => {
    const onPost = queued();
    const tree = render(onPost);
    fill(tree);
    act(() => control(tree, "More options: Closes in 1 day")!.props.onPress());
    const chips = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Voting closes in" &&
        typeof node.props.onSelect === "function",
    );
    act(() => chips.props.onSelect("1h"));
    await act(async () => postButton(tree).props.onPress());
    expect(onPost.mock.calls[0]![0].payload.closes_at).toBe(
      "2026-11-09T13:00:00.000Z",
    );
    act(() => tree.unmount());
  });

  it("withholds Doesn't close from a member who couldn't close the poll", () => {
    const tree = render(queued(), false);
    act(() => control(tree, "More options: Closes in 1 day")!.props.onPress());
    const chips = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Voting closes in" &&
        typeof node.props.onSelect === "function",
    );
    expect(
      chips.props.chips.map((chip: { value: string }) => chip.value),
    ).toEqual(["1h", "1d", "3d", "1w"]);
    act(() => tree.unmount());
  });

  it("posts a poll with no deadline for Doesn't close (#3896)", async () => {
    const onPost = queued();
    const tree = render(onPost);
    fill(tree);
    act(() => control(tree, "More options: Closes in 1 day")!.props.onPress());
    const chips = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Voting closes in" &&
        typeof node.props.onSelect === "function",
    );
    expect(chips.props.chips.at(-1)).toEqual({
      value: "never",
      label: "Doesn't close",
    });
    act(() => chips.props.onSelect("never"));
    // Collapsed again, the row says the choice in its own words.
    act(() => control(tree, "Fewer options")!.props.onPress());
    expect(control(tree, "More options: Doesn't close")).toBeTruthy();
    await act(async () => postButton(tree).props.onPress());
    expect(onPost.mock.calls[0]![0].payload.closes_at).toBeNull();
    act(() => tree.unmount());
  });

  it("adds, moves and removes option rows", async () => {
    const onPost = queued();
    const tree = render(onPost);
    fill(tree);
    // Two rows: neither can go.
    expect(control(tree, "Remove option 1")).toBeUndefined();
    act(() => control(tree, "Add option")!.props.onPress());
    type(tree, "Option 3", "Maybe");
    act(() => control(tree, "Move option 3 up")!.props.onPress());
    act(() => control(tree, "Remove option 1")!.props.onPress());
    await act(async () => postButton(tree).props.onPress());
    expect(
      onPost.mock.calls[0]![0].payload.options.map((o) => o.label),
    ).toEqual(["Maybe", "Not me"]);
    act(() => tree.unmount());
  });

  it("stops adding at ten options", () => {
    const tree = render(queued());
    for (let i = 0; i < 8; i++) {
      act(() => control(tree, "Add option")!.props.onPress());
    }
    expect(control(tree, "Add option")).toBeUndefined();
    expect(screenText(tree)).toContain("A poll can have up to 10 options.");
    act(() => tree.unmount());
  });

  it("says why when two options match, and holds Post", () => {
    const tree = render(queued());
    type(tree, "Poll question", "Night?");
    type(tree, "Option 1", "Friday");
    type(tree, "Option 2", "friday");
    expect(screenText(tree)).toContain(DUPLICATE_OPTION_PROBLEM);
    expect(postButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("keeps the draft and says so when the poll couldn't be queued", async () => {
    const onPost = vi.fn<NewPollSheetProps["onPost"]>(async () => ({
      ok: false as const,
      error: "Couldn't post that poll. Try again.",
    }));
    const tree = render(onPost);
    fill(tree);
    await act(async () => postButton(tree).props.onPress());
    expect(screenText(tree)).toContain("Couldn't post that poll. Try again.");
    expect(field(tree, "Poll question").props.value).toBe(
      "Who's driving Saturday?",
    );
    expect(successHaptic).not.toHaveBeenCalled();
    expect(postButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("queues once for two taps in one batch", async () => {
    let settle!: (value: { ok: true }) => void;
    const onPost = vi.fn<NewPollSheetProps["onPost"]>(
      () => new Promise((resolve) => (settle = resolve)),
    );
    const tree = render(onPost);
    fill(tree);
    const press = postButton(tree).props.onPress as () => void;
    act(() => {
      press();
      press();
    });
    expect(onPost).toHaveBeenCalledTimes(1);
    await act(async () => settle({ ok: true }));
    act(() => tree.unmount());
  });
});

/**
 * The close: a post that queued closes the sheet and gives the draft up,
 * Cancel gives it up, and a swipe keeps it (`patterns.md` § Bottom sheets).
 */
describe("New poll sheet across visits (#3701)", () => {
  const dismiss = vi.fn();

  function renderWithModal(
    onPost: NewPollSheetProps["onPost"],
  ): ReactTestRenderer {
    const ref = React.createRef<never>();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <NewPollSheet
            ref={ref}
            onPost={onPost}
            canCloseEarly
            now={() => NOW}
          />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) =>
            (element.type as unknown) === "BottomSheetModal"
              ? { dismiss, present: vi.fn() }
              : null,
        },
      );
    });
    // What gorhom reports as `present()` starts bringing the sheet up.
    act(() => modal(tree).props.onAnimate(-1, 0));
    return tree;
  }

  const modal = (tree: ReactTestRenderer) =>
    tree.root.find((node) => node.type === ("BottomSheetModal" as never));

  const pressCancel = (tree: ReactTestRenderer) =>
    act(() =>
      tree.root
        .find(
          (node) =>
            node.type === ("Pressable" as never) &&
            drawnText(node) === "Cancel",
        )
        .props.onPress(),
    );

  beforeEach(() => dismiss.mockReset());

  it("closes once the poll is queued", async () => {
    const tree = renderWithModal(queued());
    fill(tree);
    await act(async () => postButton(tree).props.onPress());
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("stays open, draft and all, when the poll couldn't be queued", async () => {
    const tree = renderWithModal(async () => ({
      ok: false as const,
      error: "Couldn't post that poll. Try again.",
    }));
    fill(tree);
    await act(async () => postButton(tree).props.onPress());
    expect(dismiss).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("gives the draft up on Cancel", () => {
    const tree = renderWithModal(queued());
    fill(tree);
    pressCancel(tree);
    expect(field(tree, "Poll question").props.value).toBe("");
    expect(field(tree, "Option 1").props.value).toBe("");
    expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("keeps the draft through a swipe or scrim close", () => {
    const tree = renderWithModal(queued());
    fill(tree);
    act(() => modal(tree).props.onDismiss());
    expect(field(tree, "Poll question").props.value).toBe(
      "Who's driving Saturday?",
    );
    act(() => tree.unmount());
  });

  it("releases Post if the post rejects, rather than holding at Posting…", async () => {
    const tree = renderWithModal(async () => {
      throw new Error("boom");
    });
    fill(tree);
    await act(async () => postButton(tree).props.onPress());
    expect(postButton(tree).props.disabled).toBe(false);
    expect(screenText(tree)).toContain("Couldn't post that poll. Try again.");
    act(() => tree.unmount());
  });
});

describe("New poll sheet row moves (#3701)", () => {
  it("moves the field with its text, so the row being typed in stays focused", () => {
    const tree = render(queued());
    fill(tree);
    // Typing in Option 2.
    act(() => field(tree, "Option 2").props.onFocus());
    const typing = field(tree, "Option 2");
    act(() => control(tree, "Move option 2 up")!.props.onPress());
    // The same field instance now leads the list, still holding "Not me",
    // still the focused one: the next keystrokes edit the option it shows.
    const first = field(tree, "Option 1");
    expect(first).toBe(typing);
    expect(first.props.value).toBe("Not me");
    act(() => first.props.onChangeText("Not me!"));
    expect(field(tree, "Option 1").props.value).toBe("Not me!");
    expect(field(tree, "Option 2").props.value).toBe("Me");
    act(() => tree.unmount());
  });
});
