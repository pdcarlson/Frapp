/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { AI_SUGGESTION_COPY } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/** The Tasks tab's row to the suggested tasks (#4313). */
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

import { SuggestedTasksEntry } from "./suggested-tasks-entry";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SuggestedTasksEntry />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const TASK = { kind: "task", task: { title: "Book the hall" } };

beforeEach(() => {
  vi.clearAllMocks();
  state.available = true;
  state.items = [];
});

describe("SuggestedTasksEntry", () => {
  it("asks for nothing, and draws nothing, where the server has no AI", () => {
    state.available = false;
    state.items = [TASK];
    expect(render().toJSON()).toBeNull();
    expect(state.enabled).toBe(false);
  });

  it("draws nothing while none are waiting", () => {
    expect(render().toJSON()).toBeNull();
    // A suggestion of a kind this build can't accept isn't counted.
    state.items = [{ kind: "poll", task: null }];
    expect(render().toJSON()).toBeNull();
  });

  it("counts the waiting tasks and opens the list", () => {
    state.items = [TASK, TASK, { kind: "poll", task: null }];
    const tree = render();
    expect(screenText(tree)).toContain(AI_SUGGESTION_COPY.waiting(2));
    const row = tree.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onPress === "function",
    )[0];
    act(() => row.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/suggested-tasks",
    );
  });
});
