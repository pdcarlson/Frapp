import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  focusManager,
  onlineManager,
  useMutation,
} from "@tanstack/react-query";
import { QueryProvider } from "./query-provider";

/**
 * The one behaviour this file exists to pin: **a dashboard write attempted
 * while offline must settle** (#1707).
 *
 * TanStack's default `networkMode: "online"` pauses an offline mutation instead
 * of rejecting it, so `await mutateAsync(...)` neither resolves nor throws —
 * the success toast never fires, the `catch` that would show an error toast is
 * unreachable, the dialog never closes, and `isPending` latches `true`. On
 * `tasks-board` that flag fans out and disables every row's controls
 * chapter-wide.
 *
 * These tests drive `onlineManager` and `focusManager` directly rather than
 * `navigator.onLine` / `document.visibilityState`, because those managers are
 * the inputs TanStack's retryer actually consults.
 */

/**
 * Records how `mutateAsync` settled — the whole question.
 *
 * `retryDelay` is the only TanStack knob callers get, and only to collapse the
 * provider's 1s + 2s backoff so tests stay fast. `networkMode` and `retry` are
 * never overridden: they come from the provider defaults, which are the thing
 * under test. `onAttempt` counts how many times `mutationFn` actually ran,
 * which separates "rejected after exhausting retries" from "never ran at all".
 */
function MutationHarness({
  onSettle,
  retryDelay,
  onAttempt,
}: {
  onSettle: (how: string) => void;
  retryDelay?: number;
  onAttempt?: () => void;
}) {
  const mutation = useMutation({
    // Stands in for a fetch that cannot reach the API. Under TanStack's default
    // `networkMode` this body never runs at all; the mutation parks in
    // `isPaused` before it is called — which is what `onAttempt` detects.
    mutationFn: async () => {
      onAttempt?.();
      throw new Error("network unreachable");
    },
    ...(retryDelay === undefined ? {} : { retryDelay }),
  });

  return (
    <div>
      <button
        onClick={() =>
          mutation
            .mutateAsync()
            .then(() => onSettle("resolved"))
            .catch(() => onSettle("rejected"))
        }
      >
        Save
      </button>
      <span data-testid="paused">{String(mutation.isPaused)}</span>
    </div>
  );
}

describe("QueryProvider — offline mutations", () => {
  afterEach(() => {
    // Both managers are module-global. Leaking either would silently change
    // retry behaviour in every test file that runs after this one.
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it("rejects an offline write instead of pausing it forever", async () => {
    // The whole point, and the regression test for #1707. Nothing is
    // overridden but the delay: this runs under the provider's real
    // `networkMode` and `retry`.
    //
    // Fails on `networkMode: "online"` (the old default), which parks the
    // mutation in `isPaused` before `mutationFn` is ever called, and on
    // `"offlineFirst"`, which starts the attempt but fails `canContinue()` on
    // the retry and pauses there instead.
    onlineManager.setOnline(false);
    const settled: string[] = [];

    render(
      <QueryProvider>
        <MutationHarness onSettle={(how) => settled.push(how)} retryDelay={0} />
      </QueryProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(settled).toEqual(["rejected"]));
    expect(screen.getByTestId("paused")).toHaveTextContent("false");
  });

  it("still spends its retries offline, so a brief blip can land the write", async () => {
    // `retry` is deliberately NOT made offline-aware. Refusing offline retries
    // would reject on the first failure — tidier-sounding, but it throws away
    // the AP roam or lift that comes back inside the backoff, where the write
    // currently lands invisibly. It would also falsify `retry: 2` where
    // `packages/hooks` and `docs/hooks/README.md` cite it as the reason a
    // non-idempotent compare-and-set write must opt out.
    onlineManager.setOnline(false);
    const settled: string[] = [];
    let attempts = 0;

    render(
      <QueryProvider>
        <MutationHarness
          onSettle={(how) => settled.push(how)}
          onAttempt={() => {
            attempts += 1;
          }}
          retryDelay={0}
        />
      </QueryProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(settled).toEqual(["rejected"]));
    // The provider's `retry: 2` — one initial attempt plus two retries, all of
    // which fire offline because `networkMode: "always"` clears `canContinue`'s
    // network conjunct.
    expect(attempts).toBe(3);
  });

  it("documents the residual: an online failure on a hidden tab still pauses", async () => {
    // Not a bug this change introduces, and deliberately not fixed here —
    // pinned so the next reader finds the limit stated rather than discovering
    // it in production.
    //
    // `canContinue()` is `isFocused() && (networkMode === 'always' ||
    // isOnline()) && canRun()`. `"always"` clears the middle conjunct but not
    // `isFocused()`, so a tab hidden during a backoff parks until it is
    // focused again. This is identical before and after #1707 — it is
    // TanStack's standing behaviour for ANY retried mutation, online included
    // — and it self-heals on refocus, so it is not the #1707 symptom of a
    // member watching a dialog spin.
    //
    // Closing it would mean refusing retries, which costs the blip absorption
    // the previous test pins. That is a bad trade.
    focusManager.setFocused(false);
    const settled: string[] = [];

    render(
      <QueryProvider>
        <MutationHarness onSettle={(how) => settled.push(how)} retryDelay={0} />
      </QueryProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(screen.getByTestId("paused")).toHaveTextContent("true"),
    );
    expect(settled).toEqual([]);

    // ...and resolves itself the moment the member comes back to the tab.
    focusManager.setFocused(true);
    await waitFor(() => expect(settled).toEqual(["rejected"]));
  });
});
