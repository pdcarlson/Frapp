import type { ReactNativeOptions } from "@sentry/react-native";
import { TouchEventBoundary } from "@sentry/react-native/dist/js/touchevents";
import { enableSyncToNative } from "@sentry/react-native/dist/js/scopeSync";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeRecorder,
  sdkCore,
  syncedIsolationScope,
} from "@/test/sentry-native-sync";
import { buildMobileSentryOptions } from "./options";

/**
 * Touch and rage-tap breadcrumbs, driven through the real SDK (#2982).
 *
 * `Sentry.wrap` mounts `@sentry/react-native`'s `TouchEventBoundary`, which
 * names each touched element by its `accessibilityLabel`, `testID` or visible
 * text. Those hold member names and message bodies, and the SDK copies every
 * breadcrumb into the native SDK's scope, which a native crash report carries
 * without passing any JS hook. So a fix in `beforeSend` alone would not reach
 * it.
 *
 * This spec runs the SDK's own code rather than a copy of its shapes: the
 * real boundary and rage-tap detector build the crumb, `@sentry/core`'s
 * `addBreadcrumb` applies the shipped `beforeBreadcrumb`, and the real
 * `scopeSync` patch forwards the result to native. Only the native module is
 * replaced, by a recorder. So an upgrade that changes any of those four, say
 * by forwarding to native before the hook runs, fails the native assertions.
 *
 * One step is replayed by hand rather than run: `Sentry.init` (`sdk.js`)
 * calling `enableSyncToNative` on the global and isolation scopes, which
 * `tap()` does through `syncedIsolationScope` (`test/sentry-native-sync.ts`).
 * An upgrade that changes how init wires the native sync would not fail here;
 * re-check `sdk.js` when bumping `@sentry/react-native`. The send-time pass in
 * `scrubBreadcrumb` is `packages/observability/src/sentry-scrubbing.spec.ts`'s
 * to cover.
 */

vi.mock("@sentry/react-native/dist/js/utils/rnlibraries", async () =>
  (await import("@/test/sentry-native-sync")).rnLibrariesModule(),
);
vi.mock("@sentry/react-native/dist/js/wrapper", async () =>
  (await import("@/test/sentry-native-sync")).nativeWrapperModule(),
);

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";
const MEMBER_NAME = "Jo Smith";
const RELOAD_LABEL = `Reload ${MEMBER_NAME}`;
const MESSAGE_BODY = `${MEMBER_NAME}: meet at 7 for dues`;

/** The fiber fields `TouchEventBoundary` reads while walking a touch. */
type Fiber = {
  elementType?: string | { displayName?: string };
  memoizedProps?: Record<string, unknown>;
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
};

function link(parent: Fiber, child: Fiber): Fiber {
  parent.child = child;
  child.return = parent;
  return child;
}

/** A `Pressable` wrapping a host view with an `accessibilityLabel`. */
function labelledControl(): Fiber {
  const pressable: Fiber = {
    elementType: { displayName: "Pressable" },
    memoizedProps: {},
  };
  return link(pressable, {
    elementType: "RCTView",
    memoizedProps: { accessibilityLabel: RELOAD_LABEL },
  });
}

/** A chat row with no label, whose `Text` shows the message body. */
function unlabelledMessage(): Fiber {
  const row: Fiber = { elementType: { displayName: "View" }, memoizedProps: {} };
  const text = link(row, {
    elementType: { displayName: "Text" },
    memoizedProps: { children: MESSAGE_BODY },
  });
  return link(text, {
    elementType: "RCTText",
    memoizedProps: { children: MESSAGE_BODY },
  });
}

type TouchBoundary = { _onTouchStart(event: { _targetInst: Fiber }): void };

/**
 * Taps `target` `times` times through a fresh boundary with the SDK's default
 * props, on a client carrying `beforeBreadcrumb`. Returns what the JS scope
 * kept and what the native scope was sent.
 */
function tap(
  target: Fiber,
  beforeBreadcrumb: ReactNativeOptions["beforeBreadcrumb"],
  times = 1,
) {
  sdkCore.setCurrentClient({
    getOptions: () => ({ beforeBreadcrumb, maxBreadcrumbs: 100 }),
    getIntegrationByName: () => undefined,
  });
  const scope = syncedIsolationScope(enableSyncToNative);

  const boundary = new TouchEventBoundary({
    ...TouchEventBoundary.defaultProps,
  }) as unknown as TouchBoundary;
  for (let i = 0; i < times; i++) {
    boundary._onTouchStart({ _targetInst: target });
  }
  return {
    js: scope.getScopeData().breadcrumbs as { category?: string }[],
    native: nativeRecorder.breadcrumbs as { category?: string }[],
  };
}

function shippedBeforeBreadcrumb() {
  return buildMobileSentryOptions(DSN).beforeBreadcrumb;
}

afterEach(() => {
  sdkCore.setCurrentClient(undefined);
  sdkCore.getIsolationScope().clear();
});

describe("touch breadcrumbs through the real SDK (#2982)", () => {
  it("records the accessibility label when no hook is set (the control)", () => {
    // Without this, every assertion below could pass on a boundary that never
    // recorded anything, or an SDK that stopped reading labels.
    const { js, native: sent } = tap(labelledControl(), undefined);

    expect(js).toHaveLength(1);
    expect(JSON.stringify(js)).toContain(MEMBER_NAME);
    expect(JSON.stringify(sent)).toContain(MEMBER_NAME);
  });

  it("keeps the label out of the JS scope and the native scope", () => {
    const { js, native: sent } = tap(
      labelledControl(),
      shippedBeforeBreadcrumb(),
    );

    expect(js).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(js)).not.toContain(MEMBER_NAME);
    expect(JSON.stringify(sent)).not.toContain(MEMBER_NAME);
    expect(sent[0]).toMatchObject({
      category: "touch",
      message: "Touch event within element: Pressable",
      data: { path: [{ name: "Pressable" }] },
    });
  });

  it("keeps extracted visible text out of both scopes", () => {
    const control = tap(unlabelledMessage(), undefined);
    expect(JSON.stringify(control.native)).toContain("meet at 7");

    const { js, native: sent } = tap(
      unlabelledMessage(),
      shippedBeforeBreadcrumb(),
    );

    expect(JSON.stringify(js)).not.toContain("meet at 7");
    expect(JSON.stringify(sent)).not.toContain("meet at 7");
    expect(JSON.stringify(sent)).not.toContain(MEMBER_NAME);
    expect(sent[0]).toMatchObject({
      message: "Touch event within element: Text",
    });
  });

  it("keeps the label out of a rage tap's breadcrumb, node included", () => {
    const control = tap(labelledControl(), undefined, 3);
    const controlRage = control.native.filter(
      (crumb) => crumb.category === "ui.multiClick",
    );
    expect(controlRage).toHaveLength(1);
    expect(JSON.stringify(controlRage)).toContain(MEMBER_NAME);

    const { js, native: sent } = tap(
      labelledControl(),
      shippedBeforeBreadcrumb(),
      3,
    );
    const rage = sent.filter((crumb) => crumb.category === "ui.multiClick");

    expect(rage).toHaveLength(1);
    expect(JSON.stringify(js)).not.toContain(MEMBER_NAME);
    expect(JSON.stringify(sent)).not.toContain(MEMBER_NAME);
    expect(rage[0]).toMatchObject({
      message: "Pressable",
      data: { clickCount: 3, path: [{ name: "Pressable" }] },
    });
  });
});
