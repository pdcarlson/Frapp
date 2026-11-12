/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #2259: a member without Ask has no Ask anywhere, and `frapp://ask` goes to
 * Chat home rather than an empty shell. Whether a member has Ask is the
 * server's answer (`useAiSurfaces`), no longer a build flag. The panel's Ask
 * bar is gated in `components/glass-tab-bar.spec.tsx`.
 *
 * Lives here, not beside the route: a spec under `app/` ships as a route
 * module (`lib/routes.spec.ts`).
 */
const surfaces = vi.hoisted(() => ({ ask: false, ready: true }));
vi.mock("@/lib/ai/availability", () => ({
  useAiSurfaces: () => ({
    available: surfaces.ask,
    meetingNotes: false,
    ...surfaces,
  }),
}));

// The sheet has its own spec; here it is a stand-in whose `present` and
// `onClosed` a spec can reach.
const sheet = vi.hoisted(() => ({
  present: vi.fn(),
  onClosed: undefined as undefined | (() => void),
}));
vi.mock("@/components/ask/ask-sheet", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    AskSheet: forwardRef(function AskSheet(
      props: { onClosed?: () => void },
      ref,
    ) {
      useImperativeHandle(ref, () => sheet);
      sheet.onClosed = props.onClosed;
      return React.createElement("AskSheet");
    }),
  };
});

import AskScreen from "@/app/(app)/ask";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AskScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const sheets = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "AskSheet");

beforeEach(() => {
  surfaces.ask = false;
  surfaces.ready = true;
  sheet.present.mockClear();
  sheet.onClosed = undefined;
  vi.mocked(vi.mocked(useRouter)().dismissTo).mockClear();
});

describe("the ask route (frapp://ask)", () => {
  it("goes to Chat home for a member without Ask, and draws no sheet", () => {
    const tree = render();
    // Popped down to, not replaced: a replace would stack a second tab
    // navigator over the first.
    expect(vi.mocked(useRouter)().dismissTo).toHaveBeenCalledWith("/");
    expect(sheets(tree)).toHaveLength(0);
    expect(sheet.present).not.toHaveBeenCalled();
  });

  it("waits for the server's answer before it sends anyone away", () => {
    surfaces.ready = false;
    const tree = render();
    expect(vi.mocked(useRouter)().dismissTo).not.toHaveBeenCalled();
    expect(sheets(tree)).toHaveLength(0);
  });

  it("presents the sheet on arrival for a member with Ask", () => {
    surfaces.ask = true;
    const tree = render();
    expect(vi.mocked(useRouter)().dismissTo).not.toHaveBeenCalled();
    expect(sheets(tree)).toHaveLength(1);
    expect(sheet.present).toHaveBeenCalledTimes(1);
  });

  it("goes to Chat home when the sheet closes, never the bare shell", () => {
    surfaces.ask = true;
    render();
    act(() => sheet.onClosed?.());
    expect(vi.mocked(useRouter)().dismissTo).toHaveBeenCalledWith("/");
  });
});
