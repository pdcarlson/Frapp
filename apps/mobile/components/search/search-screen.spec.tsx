/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";

/**
 * The phone's Search screen (#5139): every member has it, it lists web's
 * Find rows, keeps recent searches, and hands its words to Ask only for a
 * member who has Ask. The list itself (ranking, caps, hints) is
 * `@repo/hooks` `find-results.spec.ts`.
 */

const hooks = vi.hoisted(() => ({
  payload: null as unknown,
  fetching: false,
  error: false,
  channels: [] as unknown[],
  modules: {} as Record<string, boolean>,
  ask: false,
  chapterId: "ch-1" as string | null,
  timedOutSources: [] as string[],
  present: vi.fn(),
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useSearch: () => ({
    data: hooks.payload
      ? {
          payload: hooks.payload,
          timedOutSources: hooks.timedOutSources,
          timedOut: hooks.timedOutSources.length > 0,
        }
      : undefined,
    isPending: !hooks.payload,
    isFetching: hooks.fetching,
    isError: hooks.error,
  }),
  useChannels: () => ({ data: hooks.channels }),
  useCurrentChapter: () => ({ data: { enabled_modules: hooks.modules } }),
  useViewerUserId: () => "u-me",
  useActiveChapterId: () => hooks.chapterId,
  usePermissionList: () => [],
  useAiConsent: () => ({ data: null }),
}));
vi.mock("@repo/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));
vi.mock("@/lib/haptics", () => ({ selectionHaptic: vi.fn() }));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ ask: hooks.ask, ready: true }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#3366ff" }),
}));
vi.mock("@/components/frapp-crest", () => ({ FrappCrest: () => null }));
vi.mock("@/components/ask/ask-sheet", async () => {
  const { forwardRef, useImperativeHandle, createElement } =
    await import("react");
  return {
    AskSheet: forwardRef(function AskSheet(
      props: { initialDraft?: string },
      ref,
    ) {
      useImperativeHandle(ref, () => ({ present: hooks.present }));
      return createElement("AskSheet", props);
    }),
  };
});

import { SearchScreen, SEARCH_COPY } from "./search-screen";

const PAYLOAD = {
  members: [{ user_id: "u1", display_name: "Rush Chair Ana", email: "a@x.io" }],
  messages: [
    {
      id: "m9",
      content: "Rush week starts Monday",
      channel_id: "c1",
      created_at: "2026-11-03T16:00:00.000Z",
    },
  ],
  events: [
    { id: "e1", name: "Rush kickoff", start_time: "2026-11-16T23:00:00.000Z" },
  ],
  backwork: [{ id: "b1", title: "Rush budget" }],
};
const CHANNELS = [
  { id: "c1", name: "rush", type: "PUBLIC" },
  { id: "d1", name: "rush-dm", type: "DM" },
];

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <FrappThemeProvider>
        <SearchScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const field = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === SEARCH_COPY.placeholder &&
      typeof node.props.onChangeText === "function",
  );
const type = async (tree: ReactTestRenderer, words: string) =>
  act(async () => field(tree).props.onChangeText(words));
const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === label,
  );
const results = (tree: ReactTestRenderer) =>
  tree.root.findByProps({ testID: "search-results" });

beforeEach(() => {
  hooks.payload = PAYLOAD;
  hooks.fetching = false;
  hooks.error = false;
  hooks.channels = CHANNELS;
  hooks.modules = {};
  hooks.ask = false;
  hooks.chapterId = "ch-1";
  hooks.timedOutSources = [];
  hooks.present.mockClear();
  vi.mocked(vi.mocked(useRouter)().push).mockClear();
  vi.mocked(AsyncStorage.getItem).mockResolvedValue(null);
  vi.mocked(AsyncStorage.setItem).mockClear();
});

describe("SearchScreen", () => {
  it("lists channels, members, messages and events, never DMs or backwork", async () => {
    const tree = await render();
    await type(tree, "rush");
    const text = drawnText(results(tree));
    expect(text).toContain("#rush");
    expect(text).toContain("Rush Chair Ana");
    expect(text).toContain("Rush week starts Monday");
    expect(text).toContain("Rush kickoff");
    expect(text).not.toContain("rush-dm");
    expect(text).not.toContain("Rush budget");
  });

  it("leaves events out while the chapter has them off", async () => {
    hooks.modules = { events: false };
    const tree = await render();
    await type(tree, "rush");
    expect(drawnText(results(tree))).not.toContain("Rush kickoff");
  });

  it("asks for three characters, and says when nothing matches", async () => {
    const tree = await render();
    await type(tree, "ru");
    expect(drawnText(tree.root)).toContain(SEARCH_COPY.tooShort);
    hooks.payload = { members: [], messages: [], events: [] };
    await type(tree, "zzz");
    expect(drawnText(tree.root)).toContain(SEARCH_COPY.none);
  });

  it("opens a message at that message, and keeps the words as a recent search", async () => {
    const tree = await render();
    await type(tree, "rush");
    // The row's hint (channel and date) is find-results' own wording.
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel ?? "").startsWith(
          "Rush week starts Monday",
        ),
    );
    await act(async () => row.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/chat-thread?channelId=c1&focusMessageId=m9",
    );
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "frapp.recentSearches.u-me.ch-1",
      JSON.stringify(["rush"]),
    );
  });

  it("lists a setting the member can change, and opens it lit", async () => {
    const tree = await render();
    await type(tree, "quiet hours");
    expect(drawnText(results(tree))).toContain("Settings · Notifications");
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        String(node.props.accessibilityLabel ?? "").startsWith("Quiet hours"),
    );
    await act(async () => row.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/preferences?setting=quiet-hours",
    );
  });

  it("shows recent searches before typing, and a tap searches them again", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify(["rush", "formal"]),
    );
    const tree = await render();
    const recent = tree.root.findByProps({ testID: "recent-searches" });
    expect(drawnText(recent)).toContain("formal");
    await act(async () => pressable(tree, "Search for formal").props.onPress());
    expect(field(tree).props.value).toBe("formal");
  });

  it("offers no Ask row to a member without Ask", async () => {
    const tree = await render();
    await type(tree, "rush");
    expect(tree.root.findAllByProps({ testID: "search-ask" })).toHaveLength(0);
  });

  it("hands the words to Ask for a member who has it", async () => {
    hooks.ask = true;
    const tree = await render();
    await type(tree, "who runs rush");
    await act(async () =>
      pressable(tree, SEARCH_COPY.askAbout("who runs rush")).props.onPress(),
    );
    const sheet = tree.root.find(
      (node) => (node.type as unknown) === "AskSheet",
    );
    expect(sheet.props.initialDraft).toBe("who runs rush");
    // Mounted is not shown: the sheet is presented.
    expect(hooks.present).toHaveBeenCalled();
  });

  it("narrows to one group with its chip, and offers no chip for a group that is off", async () => {
    hooks.modules = { events: false };
    const tree = await render();
    await type(tree, "rush");
    const chips = tree.root
      .findAll((node) => node.props.accessibilityRole === "tab")
      .map((node) => drawnText(node));
    expect(chips.filter((c, i) => chips.indexOf(c) === i)).toEqual([
      "All",
      "Channels",
      "Settings",
      "Members",
      "Messages",
    ]);
    const messages = tree.root.find(
      (node) =>
        node.props.accessibilityRole === "tab" &&
        typeof node.props.onPress === "function" &&
        drawnText(node) === "Messages",
    );
    await act(async () => messages.props.onPress());
    const text = drawnText(results(tree));
    expect(text).toContain("Rush week starts Monday");
    expect(text).not.toContain("Rush Chair Ana");
  });

  it("says when a shown group timed out under rows, and ignores a hidden one", async () => {
    hooks.timedOutSources = ["messages"];
    hooks.payload = { ...PAYLOAD, messages: [] };
    const tree = await render();
    await type(tree, "rush");
    expect(drawnText(tree.root)).toContain(SEARCH_COPY.partial(["Messages"]));
    // Backwork is never listed on the phone, so its timeout is not news.
    hooks.timedOutSources = ["backwork"];
    hooks.payload = { members: [], messages: [], events: [] };
    hooks.channels = [];
    await type(tree, "zzz");
    expect(drawnText(tree.root)).toContain(SEARCH_COPY.none);
  });

  it("says search is unavailable, not that nothing matched, with no chapter", async () => {
    hooks.chapterId = null;
    const tree = await render();
    await type(tree, "rush");
    expect(drawnText(tree.root)).toContain(SEARCH_COPY.failed);
    expect(drawnText(tree.root)).not.toContain(SEARCH_COPY.none);
  });

  it("adds to the stored searches, not to an empty list still loading", async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(
      JSON.stringify(["formal"]),
    );
    const tree = await render();
    await type(tree, "rush");
    const row = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        /^rush(,|$)/.test(String(node.props.accessibilityLabel ?? "")),
    );
    await act(async () => row.props.onPress());
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "frapp.recentSearches.u-me.ch-1",
      JSON.stringify(["rush", "formal"]),
    );
  });
});
