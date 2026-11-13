/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  chapterId: "chapter-1",
  permissions: ["*"] as string[] | undefined,
  modules: {} as Record<string, boolean> | undefined,
  /** Pending reads, by chapter, resolved by the test. */
  reads: new Map<string, (keys: string[] | null) => void>(),
  write: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => state.chapterId,
  useViewerUserId: () => "user-1",
  useMyPermissions: () => ({
    data: state.permissions ? { permissions: state.permissions } : undefined,
  }),
  useCurrentChapter: () => ({
    data: state.modules ? { enabled_modules: state.modules } : undefined,
  }),
}));

vi.mock("@/lib/quick-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/quick-actions")>()),
  readSavedQuickActions: (_user: string, chapter: string | null) =>
    new Promise<string[] | null>((resolve) =>
      state.reads.set(chapter ?? "sole", resolve),
    ),
  writeSavedQuickActions: state.write,
}));

import { type QuickActionsState, useQuickActions } from "./use-quick-actions";

let latest!: QuickActionsState;
const capture = (value: QuickActionsState) => {
  latest = value;
};
function Harness({ onState = capture }: { onState?: typeof capture }) {
  const value = useQuickActions();
  onState(value);
  return null;
}

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Harness />);
  });
  return tree;
}

async function settle(chapter: string, keys: string[] | null) {
  await act(async () => {
    state.reads.get(chapter)?.(keys);
    await Promise.resolve();
  });
}

beforeEach(() => {
  state.chapterId = "chapter-1";
  state.permissions = ["*"];
  state.modules = {};
  state.reads.clear();
  state.write.mockReset();
});

describe("useQuickActions", () => {
  it("offers New event to an officer who can create events", () => {
    render();
    expect(latest.available).toContain("newEvent");
    state.permissions = ["events:create"];
    render();
    // The events controller also guards create with members:view.
    expect(latest.available).not.toContain("newEvent");
  });

  it("shows the saved arrangement once it is read", async () => {
    render();
    expect(latest.shown[0]).toBe("newEvent");
    await settle("chapter-1", ["study", "message"]);
    expect(latest.shown).toEqual(["study", "message"]);
  });

  it("shows the starting set in a new chapter until its own is read", async () => {
    const tree = render();
    await settle("chapter-1", ["study"]);
    state.chapterId = "chapter-2";
    act(() => tree.update(<Harness />));
    expect(latest.shown).not.toEqual(["study"]);
    await settle("chapter-2", ["upload"]);
    expect(latest.shown).toEqual(["upload"]);
  });

  it("saves an edit to the phone for this member and chapter", async () => {
    render();
    await settle("chapter-1", ["study", "message"]);
    act(() => latest.save(["message"]));
    expect(latest.shown).toEqual(["message"]);
    expect(state.write).toHaveBeenCalledWith("user-1", "chapter-1", [
      "message",
    ]);
  });

  it("keeps an edit made before the read came back", async () => {
    render();
    act(() => latest.save(["invite"]));
    await settle("chapter-1", ["study", "message"]);
    expect(latest.shown).toEqual(["invite"]);
  });

  it("keeps an action its module hides through an unrelated edit", async () => {
    state.modules = { documents: false };
    render();
    await settle("chapter-1", ["upload", "message", "invite"]);
    expect(latest.shown).toEqual(["message", "invite"]);
    act(() => latest.save(["invite", "message"]));
    expect(state.write).toHaveBeenLastCalledWith("user-1", "chapter-1", [
      "invite",
      "message",
      "upload",
    ]);
  });

  it("is ready once the role and the chapter are in hand", () => {
    state.permissions = undefined;
    const tree = render();
    expect(latest.ready).toBe(false);
    state.permissions = ["*"];
    act(() => tree.update(<Harness />));
    expect(latest.ready).toBe(true);
  });
});
