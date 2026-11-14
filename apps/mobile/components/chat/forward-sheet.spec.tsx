/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { AccessibilityInfo, Alert } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chatMessagesKey,
  forwardedFromOf,
  type ChannelCache,
} from "@repo/chat-core/types";
import { emptyCache, selectMessages } from "@repo/chat-core/cache";
import { FrappThemeProvider } from "@/lib/theme";

// The Forward to picker (#4864): the conversations the viewer can post in,
// a search over them, one pick, an optional comment, and Send, which forwards
// through `useForwardMessage`, closes on success and keeps the draft up
// behind an alert that says whether a retry can help on failure.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER = "11111111-1111-4111-8111-111111111111";
const ALICE = "22222222-2222-4222-8222-222222222222";

const CHANNELS = [
  { id: "c-general", name: "general", type: "PUBLIC", can_post: true },
  { id: "c-announce", name: "announcements", type: "PUBLIC", can_post: false },
  { id: "c-random", name: "random", type: "PUBLIC" },
  {
    id: "dm-alice",
    name: `dm-${VIEWER}-${ALICE}`,
    type: "DM",
    member_ids: [VIEWER, ALICE],
  },
];

const forward = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));
const connection = vi.hoisted(() => ({
  writeBlockedReason: null as string | null,
}));
const haptics = vi.hoisted(() => ({ selection: vi.fn() }));

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useChannels: () => ({ data: CHANNELS, isPending: false }),
    useForwardMessage: () => forward,
    useMemberDisplayNames: () => ({
      byId: { [ALICE]: "Alice Chen" },
      avatarFor: () => null,
      avatarTintFor: () => null,
    }),
    useChapterRoster: () => ({
      data: [{ user_id: ALICE, display_name: "Alice Chen" }],
    }),
    useMentionRoles: () => ({ data: [] }),
  };
});

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({
    state: connection.writeBlockedReason ? "OFFLINE" : "ONLINE",
    isOffline: connection.writeBlockedReason !== null,
    isDegraded: false,
    writeBlockedReason: connection.writeBlockedReason,
  }),
}));

vi.mock("@/lib/haptics", () => ({ selectionHaptic: haptics.selection }));

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

import { ForwardSheet } from "./forward-sheet";
import {
  FORWARD_COMMENT_PLACEHOLDER,
  FORWARD_DONE_ANNOUNCEMENT,
  FORWARD_FAILED_TITLE,
  FORWARD_RETRY_BODY,
  FORWARD_SEARCH_PLACEHOLDER,
  FORWARD_SHEET_TITLE,
  FORWARD_UNAVAILABLE_BODY,
} from "@repo/hooks/forward-destinations";
import { type ForwardTarget } from "@repo/chat-core/forward";

const TARGET: ForwardTarget = {
  messageId: "m1",
  preview: forwardedFromOf({
    message_id: "m1",
    channel_id: "c-general",
    sender_id: ALICE,
    author_name: null,
    content: "pizza at eight",
    gif: null,
    attachment_count: 0,
    created_at: "2026-11-13T18:00:00.000Z",
  })!,
  hidden: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let queryClient: QueryClient;
let dismiss: ReturnType<typeof vi.fn>;

function render(target: ForwardTarget | null = TARGET): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={queryClient}>
        <FrappThemeProvider>
          <ForwardSheet
            target={target}
            nameFor={() => null}
            viewerId={VIEWER}
          />
        </FrappThemeProvider>
      </QueryClientProvider>,
      {
        createNodeMock: (element) =>
          element.type === "BottomSheetModal"
            ? { present: vi.fn(), dismiss }
            : null,
      },
    );
  });
  return tree;
}

function flat(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function rowLabels(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        typeof node.props.onPress === "function",
    )
    .map((node) => node.props.accessibilityLabel as string);
}

function press(tree: ReactTestRenderer, label: string) {
  const node = tree.root.find(
    (candidate) =>
      candidate.props.accessibilityLabel === label &&
      typeof candidate.props.onPress === "function",
  );
  act(() => node.props.onPress());
}

function sendButton(tree: ReactTestRenderer) {
  return tree.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      typeof node.props.onPress === "function" &&
      node.props.accessibilityState?.busy !== undefined,
  );
}

function type(tree: ReactTestRenderer, label: string, text: string) {
  const input = tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === label,
  );
  act(() => input.props.onChangeText(text));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  queryClient = new QueryClient();
  dismiss = vi.fn();
  forward.mutateAsync.mockReset();
  forward.isPending = false;
  connection.writeBlockedReason = null;
  haptics.selection.mockReset();
  vi.mocked(Alert.alert).mockClear();
  vi.mocked(AccessibilityInfo.announceForAccessibility).mockClear();
});

describe("ForwardSheet (#4864)", () => {
  it("titles the picker and previews the message being forwarded", () => {
    const tree = render();
    const drawn = flat(tree);
    expect(drawn).toContain(FORWARD_SHEET_TITLE);
    expect(drawn).toContain("pizza at eight");
    expect(drawn).toContain(FORWARD_SEARCH_PLACEHOLDER);
    expect(drawn).toContain(FORWARD_COMMENT_PLACEHOLDER);
  });

  it("draws nothing to send from without a message", () => {
    const tree = render(null);
    expect(flat(tree)).not.toContain(FORWARD_SHEET_TITLE);
  });

  it("offers every conversation the viewer can post in, the DM by the other member's name", () => {
    expect(rowLabels(render())).toEqual(["#general", "#random", "Alice Chen"]);
  });

  it("narrows the conversations as the member searches", () => {
    const tree = render();
    type(tree, FORWARD_SEARCH_PLACEHOLDER, "ali");
    expect(rowLabels(tree)).toEqual(["Alice Chen"]);
    type(tree, FORWARD_SEARCH_PLACEHOLDER, "qqq");
    expect(rowLabels(tree)).toEqual([]);
  });

  it("holds Send until a conversation is picked, then marks the pick", () => {
    const tree = render();
    expect(sendButton(tree).props.disabled).toBe(true);
    press(tree, "#random");
    expect(sendButton(tree).props.disabled).toBe(false);
    const picked = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "#random" &&
        node.props.accessibilityRole === "radio",
    );
    expect(picked.props.accessibilityState).toEqual({ checked: true });
  });

  it("forwards with the comment, closes, and says Forwarded", async () => {
    const row = {
      id: "m2",
      channel_id: "c-random",
      sender_id: VIEWER,
      content: "look",
      kind: "text",
      created_at: "2026-11-13T19:00:00.000Z",
      client_message_id: "k",
      forwarded_from: TARGET.preview,
    };
    forward.mutateAsync.mockResolvedValue(row);
    queryClient.setQueryData<ChannelCache>(
      chatMessagesKey("c-random"),
      emptyCache(),
    );
    const tree = render();
    press(tree, "#random");
    type(tree, FORWARD_COMMENT_PLACEHOLDER, "look");
    act(() => sendButton(tree).props.onPress());
    await flush();

    expect(forward.mutateAsync).toHaveBeenCalledWith({
      messageId: "m1",
      channelId: "c-random",
      content: "look",
      clientMessageId: expect.any(String),
      mentionPicks: [],
    });
    expect(dismiss).toHaveBeenCalled();
    expect(haptics.selection).toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      FORWARD_DONE_ANNOUNCEMENT,
    );
    expect(Alert.alert).not.toHaveBeenCalled();
    // The new row is in the destination's timeline at once.
    const cached = selectMessages(
      queryClient.getQueryData<ChannelCache>(chatMessagesKey("c-random")),
    );
    expect(cached.map((message) => message.id)).toEqual(["m2"]);
  });

  it("offers the composer's @ list in the comment and sends the member picked as a mention pick (#4907)", async () => {
    forward.mutateAsync.mockResolvedValue({ id: "m2", channel_id: "c-random" });
    const tree = render();
    press(tree, "#random");
    const comment = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetTextInput" &&
        node.props.accessibilityLabel === FORWARD_COMMENT_PLACEHOLDER,
    );
    act(() => comment.props.onFocus?.());
    act(() => comment.props.onChangeText("for @ali"));
    press(tree, "Mention Alice Chen");
    expect(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "BottomSheetTextInput" &&
          node.props.accessibilityLabel === FORWARD_COMMENT_PLACEHOLDER,
      ).props.value,
    ).toBe("for @Alice Chen ");
    act(() => sendButton(tree).props.onPress());
    await flush();
    expect(forward.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "for @Alice Chen ",
        mentionPicks: [{ user_id: ALICE, label: "Alice Chen" }],
      }),
    );
  });

  it("offers members in the conversations' place, and never Frapp, since a forward can't ask", () => {
    const tree = render();
    press(tree, "#random");
    const comment = tree.root.find(
      (node) =>
        (node.type as unknown) === "BottomSheetTextInput" &&
        node.props.accessibilityLabel === FORWARD_COMMENT_PLACEHOLDER,
    );
    act(() => comment.props.onFocus?.());
    // A bare `@` is where the composer offers Frapp first.
    act(() => comment.props.onChangeText("@"));
    const offered = tree.root
      .findAll(
        (node) =>
          typeof node.props.accessibilityLabel === "string" &&
          typeof node.props.onPress === "function" &&
          node.props.accessibilityRole === "button" &&
          node.props.accessibilityLabel !== "Cancel",
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(offered).toContain("Mention Alice Chen");
    expect(offered.some((label) => label.includes("Frapp"))).toBe(false);
    expect(rowLabels(tree)).toEqual([]);
  });

  it("drops a pick the comment no longer writes", async () => {
    forward.mutateAsync.mockResolvedValue({ id: "m2", channel_id: "c-random" });
    const tree = render();
    press(tree, "#random");
    const comment = () =>
      tree.root.find(
        (node) =>
          (node.type as unknown) === "BottomSheetTextInput" &&
          node.props.accessibilityLabel === FORWARD_COMMENT_PLACEHOLDER,
      );
    act(() => comment().props.onFocus?.());
    act(() => comment().props.onChangeText("@ali"));
    press(tree, "Mention Alice Chen");
    type(tree, FORWARD_COMMENT_PLACEHOLDER, "never mind");
    act(() => sendButton(tree).props.onPress());
    await flush();
    expect(forward.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mentionPicks: [] }),
    );
  });

  it("stays up behind an alert on a refusal, saying a retry won't help", async () => {
    forward.mutateAsync.mockRejectedValue({ statusCode: 403 });
    const tree = render();
    press(tree, "#general");
    act(() => sendButton(tree).props.onPress());
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith(
      FORWARD_FAILED_TITLE,
      FORWARD_UNAVAILABLE_BODY,
    );
    expect(dismiss).not.toHaveBeenCalled();
    expect(sendButton(tree).props.disabled).toBe(false);
  });

  it("asks for another try on anything else, and retries the same draft under the same key", async () => {
    const first = deferred<never>();
    forward.mutateAsync.mockReturnValueOnce(first.promise);
    const tree = render();
    press(tree, "#general");
    act(() => sendButton(tree).props.onPress());
    first.reject({ statusCode: 502 });
    await flush();
    expect(Alert.alert).toHaveBeenCalledWith(
      FORWARD_FAILED_TITLE,
      FORWARD_RETRY_BODY,
    );

    forward.mutateAsync.mockRejectedValue({ statusCode: 502 });
    act(() => sendButton(tree).props.onPress());
    await flush();
    const keys = forward.mutateAsync.mock.calls.map(
      ([input]) => (input as { clientMessageId: string }).clientMessageId,
    );
    expect(keys[1]).toBe(keys[0]);

    // A changed comment is a new draft, under a new key.
    type(tree, FORWARD_COMMENT_PLACEHOLDER, "edited");
    act(() => sendButton(tree).props.onPress());
    await flush();
    const third = (
      forward.mutateAsync.mock.calls[2]![0] as { clientMessageId: string }
    ).clientMessageId;
    expect(third).not.toBe(keys[0]);
  });

  it("holds Send while a forward is in flight", () => {
    forward.isPending = true;
    const tree = render();
    press(tree, "#general");
    expect(sendButton(tree).props.disabled).toBe(true);
  });

  it("disables Send offline and says why, since a forward has no queue", () => {
    connection.writeBlockedReason = "Reconnect to make changes";
    const tree = render();
    press(tree, "#general");
    const send = sendButton(tree);
    expect(send.props.disabled).toBe(true);
    expect(send.props.accessibilityHint).toBe("Reconnect to make changes");
    expect(flat(tree)).toContain("Reconnect to make changes");
    act(() => send.props.onPress());
    expect(forward.mutateAsync).not.toHaveBeenCalled();
  });
});
