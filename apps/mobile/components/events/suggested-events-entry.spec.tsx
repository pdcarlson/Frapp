/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { LAST_YEAR_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/** The Events tab's row to "This time last year" (#3930). */
const state = vi.hoisted(() => ({
  available: true as boolean | undefined,
  items: [] as unknown[],
  enabled: undefined as boolean | undefined,
}));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiSuggestions: (options: { enabled: boolean }) => {
    state.enabled = options.enabled;
    return { data: { items: state.items, has_more: false } };
  },
}));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({ available: state.available }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { SuggestedEventsEntry } from "./suggested-events-entry";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SuggestedEventsEntry />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const EVENT = { kind: "event", event: { name: "Spring formal" } };
const TASK = { kind: "task", task: { title: "Book the hall" } };

beforeEach(() => {
  vi.clearAllMocks();
  state.available = true;
  state.items = [];
});

describe("SuggestedEventsEntry", () => {
  it("asks for nothing, and draws nothing, where the server has no AI", () => {
    state.available = false;
    state.items = [EVENT];
    expect(render().toJSON()).toBeNull();
    expect(state.enabled).toBe(false);
  });

  it("draws nothing while no event is waiting, whatever tasks are", () => {
    state.items = [TASK];
    expect(render().toJSON()).toBeNull();
  });

  it("counts the events, in words, and opens the list", () => {
    state.items = [EVENT, EVENT, TASK];
    const tree = render();
    expect(screenText(tree)).toContain(LAST_YEAR_COPY.waiting(2));
    const row = tree.root.findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        typeof node.props.onPress === "function",
    )[0]!;
    act(() => row.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith("/suggested-tasks");
  });

  it("says one event as one", () => {
    state.items = [EVENT];
    expect(screenText(render())).toContain("1 event from this time last year");
  });
});
