/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

/**
 * The s20 "Log service hours" sheet on a subscription refusal (#2410), the
 * fourth paid-ops write surface after the three #2297 fixed.
 *
 * `POST /v1/service-entries` carries no `@FreeTier`, so a brand-new chapter
 * (`incomplete` until checkout) is refused on every submit. A refusal
 * withdraws Submit, because retrying is the one thing that cannot work until
 * an officer sorts out billing. An ordinary failed save keeps Submit and its
 * "try again" copy.
 *
 * It renders `app/(tabs)/service-hours.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

/** What `ChapterGuard` throws for a chapter that never finished checkout. */
const REFUSED = {
  statusCode: 403,
  error: "Forbidden",
  message:
    "Chapter subscription is not active; complete checkout to use this feature.",
  requestId: "req_refused",
};

/**
 * A 403 that is NOT the subscription gate. `service-entry.controller.ts`
 * carries a `@RequirePermissions` on this route, and a denial there recovers
 * once an officer grants the role, so it must keep its retry.
 */
const DENIED = {
  statusCode: 403,
  error: "Forbidden",
  message: "No roles assigned",
  requestId: "req_denied",
};

/** Any failure that is not the subscription gate. */
const FAILED = {
  statusCode: 500,
  error: "Internal Server Error",
  message: "Service entry service is unavailable.",
  requestId: "req_failed",
};

const TRY_AGAIN = "That didn't save. Your entry is still here — try again.";

let failure: unknown = REFUSED;
const mutate = vi.fn(
  (_body: unknown, options: { onError: (error: unknown) => void }) =>
    options.onError(failure),
);

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => "user-1",
  useCurrentUser: () => ({ isError: false }),
  useServiceEntries: () => ({
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
  }),
  useCreateServiceEntry: () => ({ mutate, isPending: false }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: null }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import ServiceHoursScreen from "@/app/(tabs)/service-hours";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ServiceHoursScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/**
 * Everything the screen says, as one string, so a check for text the screen
 * must never show is a substring test. Matching whole `Text` elements would
 * miss the text inside a longer sentence (`<Text>Details: {message}</Text>`),
 * and `String()` of a children array joins it with commas.
 */
const screenText = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as never)
    .map((node) =>
      [node.props.children]
        .flat(Infinity)
        .filter((part) => typeof part === "string" || typeof part === "number")
        .join(""),
    )
    .join("\n");

/** The sheet's primary action, the only control carrying `accessibilityState`. */
const submitButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityState !== undefined,
  );

const logButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === "Log service hours",
  );

function fill(tree: ReactTestRenderer) {
  const field = (label: string) =>
    tree.root.find((node) => node.props.accessibilityLabel === label);
  act(() => field("Service description").props.onChangeText("Food bank"));
  act(() => field("Duration in hours").props.onChangeText("2:30"));
}

function submitEntry(tree: ReactTestRenderer) {
  fill(tree);
  expect(submitButton(tree).props.disabled).toBe(false);
  act(() => submitButton(tree).props.onPress());
}

describe("Service hours on a subscription refusal (#2410)", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("explains the refusal and withdraws Submit", () => {
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    // The server's own words are a purchase instruction, which the store
    // declaration forbids inside the app.
    expect(screenText(tree)).not.toContain(REFUSED.message);
    expect(submitButton(tree).props.disabled).toBe(true);
    // A screen reader lands on the disabled button, so the reason rides on it.
    expect(submitButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    act(() => tree.unmount());
  });

  it("keeps Submit and its retry copy after an ordinary failure", () => {
    // The direction that got an earlier attempt at #2297 reverted: only a
    // refusal may withdraw the retry.
    failure = FAILED;
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("keeps the retry on a 403 that is not the subscription gate", () => {
    // A bare status check is the trap: a permission denial recovers once an
    // officer grants the role.
    failure = DENIED;
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });

  it("clears the refusal when the sheet is opened again", () => {
    // A tab screen is never unmounted, so without the reset an officer fixing
    // billing would leave Submit dead until a force-quit.
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);
    expect(submitButton(tree).props.disabled).toBe(true);

    act(() => logButton(tree).props.onPress());

    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});
