/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import { moduleDisabledMessage } from "@repo/validation";

/**
 * The s20 "Log service hours" sheet on a subscription refusal (#2410), the
 * fourth paid-ops write surface after the three #2297 fixed.
 *
 * `POST /v1/service-entries` carries no `@FreeTier`, so a brand-new chapter
 * (`incomplete` until checkout) is refused on every submit. A refusal
 * withdraws Submit, because retrying is the one thing that cannot work until
 * an officer sorts out billing. An ordinary failed save keeps Submit and its
 * "try again" copy. The module gate (`@RequireModule('hours')`, #2718) is the
 * other refusal retrying can't win, and gets the same treatment.
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
 * What `ChapterGuard` throws when an officer has switched `hours` off (#2718),
 * shaped like the real filter output but without its `code`: only the message
 * identifies it on installed builds and an API older than #1020.
 */
const MODULE_OFF = {
  statusCode: 403,
  error: "Forbidden",
  message: moduleDisabledMessage("hours"),
  requestId: "req_module_off",
};

/**
 * A 403 that is NOT either gate. `service-entry.controller.ts`
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

/** `null` online; the offline copy from `lib/connection/state.ts` otherwise. */
let writeBlockedReason: string | null = null;

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason }),
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

beforeEach(() => {
  mutate.mockClear();
  writeBlockedReason = null;
});

describe("Service hours on a subscription refusal (#2410)", () => {

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

  // The direction that got an earlier attempt at #2297 reverted: only a
  // refusal may withdraw the retry. The 403 is the trap: a bare status check
  // would take the retry from a permission denial, which recovers once an
  // officer grants the role.
  it.each([
    ["an ordinary failure", FAILED],
    ["a 403 that is neither gate", DENIED],
  ])("keeps Submit and its retry copy after %s", (_label, error) => {
    failure = error;
    const tree = render();
    submitEntry(tree);

    expect(screenText(tree)).toContain(TRY_AGAIN);
    expect(screenText(tree)).not.toContain(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(submitButton(tree).props.disabled).toBe(false);
    expect(submitButton(tree).props.accessibilityHint).toBeUndefined();
    act(() => tree.unmount());
  });

  it("drops an earlier failure's retry copy when the next submit is refused", () => {
    // Otherwise "try again" sits beside the refusal under a disabled Submit,
    // the contradiction this fix exists to remove.
    failure = FAILED;
    const tree = render();
    submitEntry(tree);
    expect(screenText(tree)).toContain(TRY_AGAIN);

    failure = REFUSED;
    act(() => submitButton(tree).props.onPress());

    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    expect(submitButton(tree).props.disabled).toBe(true);
    act(() => tree.unmount());
  });

  it("names the refusal, not the connection, on the button when both apply", () => {
    // Reconnecting clears the offline block and leaves the refusal, so a hint
    // naming only the connection would promise a fix that doesn't come.
    failure = REFUSED;
    const tree = render();
    submitEntry(tree);

    writeBlockedReason = "Reconnect to make changes.";
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <ServiceHoursScreen />
        </FrappThemeProvider>,
      ),
    );

    expect(submitButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.accessibilityHint).toBe(
      SUBSCRIPTION_REFUSAL_COPY.serviceHours,
    );
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

describe("Service hours on a module-off refusal (#2718)", () => {
  it("explains a module-off refusal in the member's terms and withdraws Submit", () => {
    failure = MODULE_OFF;
    const tree = render();
    submitEntry(tree);

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(screenText(tree)).not.toContain(TRY_AGAIN);
    // The guard's own words tell an officer to go to Settings → Modules.
    expect(screenText(tree)).not.toContain(MODULE_OFF.message);
    expect(submitButton(tree).props.disabled).toBe(true);
    expect(submitButton(tree).props.accessibilityHint).toBe(
      MODULE_REFUSAL_COPY.serviceHours,
    );
    act(() => tree.unmount());
  });

  it("clears a module-off refusal when the sheet is opened again", () => {
    // An officer may have turned hours back on since, and reopening is the
    // member's deliberate second try, not a retry in place.
    failure = MODULE_OFF;
    const tree = render();
    submitEntry(tree);
    expect(submitButton(tree).props.disabled).toBe(true);

    act(() => logButton(tree).props.onPress());

    expect(screenText(tree)).not.toContain(MODULE_REFUSAL_COPY.serviceHours);
    expect(submitButton(tree).props.disabled).toBe(false);
    act(() => tree.unmount());
  });
});
