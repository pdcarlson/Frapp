/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The places listed above Ask Frapp's field while a member types (#4904):
 * what is listed, when, and where a row goes. The list itself (ranking,
 * caps, hints) is `@repo/hooks` `find-results.spec.ts`.
 */

const hooks = vi.hoisted(() => ({
  searched: [] as string[],
  payload: null as unknown,
  fetching: false,
  channels: [] as unknown[],
  modules: {} as Record<string, boolean>,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useSearch: (query: string) => {
    hooks.searched.push(query);
    return {
      data: hooks.payload ? { payload: hooks.payload } : undefined,
      isPending: !hooks.payload,
      isFetching: hooks.fetching,
    };
  },
  useChannels: () => ({ data: hooks.channels }),
  useCurrentChapter: () => ({ data: { enabled_modules: hooks.modules } }),
}));
// The debounce is the shared hook's own business; here a value settles at once.
vi.mock("@repo/hooks/use-debounced-value", () => ({
  useDebouncedValue: <T,>(value: T) => value,
}));
vi.mock("@/lib/haptics", () => ({ selectionHaptic: vi.fn() }));

import { AskFind } from "./ask-find";

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
  { id: "c2", name: "general", type: "PUBLIC" },
  { id: "d1", name: "rush-dm", type: "DM" },
];

function render(query: string, onOpen = vi.fn()) {
  let tree!: ReactTestRenderer;
  const element = (q: string) => (
    <FrappThemeProvider>
      <AskFind query={q} onOpen={onOpen} />
    </FrappThemeProvider>
  );
  act(() => {
    tree = create(element(query));
  });
  return {
    tree,
    onOpen,
    type: (q: string) => act(() => tree.update(element(q))),
  };
}
const rows = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Pressable");

beforeEach(() => {
  hooks.searched = [];
  hooks.payload = PAYLOAD;
  hooks.fetching = false;
  hooks.channels = CHANNELS;
  hooks.modules = {};
});

describe("AskFind", () => {
  it("lists the channels, members, messages and events that match, under their group, and never backwork or a DM", () => {
    const { tree } = render("rush");
    const text = screenText(tree);
    expect(text).toContain("Channels");
    expect(text).toContain("#rush");
    expect(text).not.toContain("general");
    expect(text).not.toContain("rush-dm");
    expect(text).toContain("Rush Chair Ana");
    expect(text).toContain("Rush week starts Monday");
    expect(text).toContain("Rush kickoff");
    expect(text).not.toContain("Backwork");
    expect(text).not.toContain("Rush budget");
    expect(rows(tree)).toHaveLength(4);
  });

  it("opens the thing a row names", () => {
    const { tree, onOpen } = render("rush");
    const message = rows(tree).find((row) =>
      String(row.props.accessibilityLabel).startsWith("Rush week"),
    )!;
    expect(message.props.accessibilityRole).toBe("button");
    act(() => message.props.onPress());
    expect(onOpen).toHaveBeenCalledWith({
      pathname: "/chat-thread",
      params: { channelId: "c1", focusMessageId: "m9" },
    });
  });

  it("leaves events out for a chapter with the module off", () => {
    hooks.modules = { events: false };
    const { tree } = render("rush");
    expect(screenText(tree)).not.toContain("Rush kickoff");
  });

  it("draws nothing when nothing matches: asking is still right there", () => {
    hooks.payload = { members: [], messages: [], events: [], backwork: [] };
    hooks.channels = [];
    const { tree } = render("zzzz");
    expect(tree.toJSON()).toBeNull();
  });

  it("keeps the last settled list while the next search is out, and clears it under three characters", () => {
    const view = render("rush");
    expect(rows(view.tree)).toHaveLength(4);
    hooks.fetching = true;
    view.type("rush w");
    // Still the rows for "rush": nothing blinks away mid-search.
    expect(rows(view.tree)).toHaveLength(4);
    hooks.fetching = false;
    hooks.payload = { ...PAYLOAD, members: [], events: [] };
    hooks.channels = [];
    view.type("rush we");
    expect(rows(view.tree)).toHaveLength(1);
    view.type("ru");
    expect(view.tree.toJSON()).toBeNull();
  });
});
