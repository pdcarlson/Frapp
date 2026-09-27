/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * The new-task sheet on a subscription refusal (#2297), rendered (#2416).
 *
 * A refusal withdraws Create, because retrying is the one thing that cannot
 * work until an officer sorts out billing. An ordinary failed save keeps
 * Create and its "try again" copy. This replaces a source-string lock on
 * `canSubmit`.
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Task service is unavailable.",
  requestId: "req_failed",
};

const TRY_AGAIN = "That didn't save. Your task is still here — try again.";

let failure: unknown = REFUSED;
const mutate = vi.fn(
  (_body: unknown, options: { onError: (error: unknown) => void }) =>
    options.onError(failure),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => "user-1",
  useChapterRoster: () => ({ data: [] }),
  useCreateTask: () => ({ mutate, isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { NewTaskSheet } from "./new-task-sheet";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewTaskSheet now={new Date("2026-09-27T12:00:00Z")} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const createButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.label === "Create task" && typeof node.type === "function",
  );

function submitTask(tree: ReactTestRenderer) {
  const title = tree.root.find(
    (node) => node.props.accessibilityLabel === "Task title",
  );
  act(() => title.props.onChangeText("Sweep the porch"));
  expect(createButton(tree).props.disabled).toBe(false);
  act(() => createButton(tree).props.onPress());
}

describe("New task on a subscription refusal (#2297)", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("explains the refusal and withdraws Create", () => {
    failure = REFUSED;
    const tree = render();
    submitTask(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(createButton(tree).props.disabled).toBe(true);
    // A screen reader lands on the disabled button, so the reason rides on it.
    expect(createButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.task,
    );
    act(() => tree.unmount());
  });

  it("keeps Create and its retry copy after an ordinary failure", () => {
    // The direction that got an earlier attempt at #2297 reverted: only a
    // refusal may withdraw the retry.
    failure = FAILED;
    const tree = render();
    submitTask(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(SUBSCRIPTION_REFUSAL_COPY.task);
    expect(createButton(tree).props.disabled).toBe(false);
    expect(createButton(tree).props.accessibilityHint).toBeUndefined();
    act(() => tree.unmount());
  });
});
