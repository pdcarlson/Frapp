import { createRequire } from "node:module";
import type { ReactNativeOptions } from "@sentry/react-native";
import { breadcrumbsIntegration } from "@sentry/react-native/dist/js/integrations/breadcrumbs";
import { enableSyncToNative } from "@sentry/react-native/dist/js/scopeSync";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildMobileSentryOptions } from "./options";

/**
 * Request and console breadcrumbs, driven through the real SDK (#3104).
 *
 * `@sentry/react-native` turns on `@sentry/browser`'s breadcrumbs integration
 * with `xhr` and `console`, plus `fetch` when the global `fetch` is
 * `expo/fetch`, which Expo SDK 57 installs by default. A request crumb's
 * `data.url` is the URL as called, so a typed search's query rides in it, and
 * a console crumb's `data.arguments` is whatever was logged. The SDK copies
 * every breadcrumb into the native SDK's scope, and a native crash report
 * carries that copy without passing `beforeSend`.
 *
 * Like `touch-breadcrumbs.spec.ts`, this runs the SDK's own code: React
 * Native's integration options, the browser SDK's instrumentation and
 * handlers build each crumb, `@sentry/core`'s `addBreadcrumb` applies the
 * shipped `beforeBreadcrumb`, and the real `scopeSync` patch forwards the
 * result to native. Only the platform is faked: the network under `fetch` and
 * `XMLHttpRequest`, the console's output, and the native module, which is a
 * recorder.
 *
 * Two steps are replayed by hand, as in the touch spec, because the SDK's
 * index cannot load under vitest: `Sentry.init` (`sdk.js`) calling
 * `enableSyncToNative`, and the client's `setupIntegrations` calling the
 * integration's `setup`. Re-check `sdk.js` when bumping
 * `@sentry/react-native`. The rule itself is
 * `packages/observability/src/sentry-scrubbing.spec.ts`'s to cover.
 */

type SdkScope = Parameters<typeof enableSyncToNative>[0];
type SdkClient = Parameters<
  ReturnType<typeof breadcrumbsIntegration>["setup"] & object
>[0];

/**
 * `@sentry/core` as `@sentry/react-native` resolves it; see
 * `touch-breadcrumbs.spec.ts` for why the spec must not use its own.
 */
const sdkCore = createRequire(
  createRequire(import.meta.url).resolve("@sentry/react-native/package.json"),
)("@sentry/core") as {
  getIsolationScope(): SdkScope;
  setCurrentClient(client: unknown): void;
};

const native = vi.hoisted(() => ({ breadcrumbs: [] as unknown[] }));

// `utils/environment` deep-imports React Native internals that vitest's
// `react-native-web` alias cannot load.
vi.mock("@sentry/react-native/dist/js/utils/rnlibraries", () => ({
  ReactNativeLibraries: {},
}));
// Under the `react-native-web` alias `Platform.OS` is `web`, which would give
// the integration the browser's options. The app runs on iOS and Android.
vi.mock(
  "@sentry/react-native/dist/js/utils/environment",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    isWeb: () => false,
  }),
);
vi.mock("@sentry/react-native/dist/js/wrapper", () => ({
  NATIVE: {
    addBreadcrumb: (breadcrumb: unknown) => {
      native.breadcrumbs.push(structuredClone(breadcrumb));
    },
  },
}));

const DSN = "https://examplepublickey@o0.ingest.sentry.io/0";
const MEMBER_NAME = "Jo Smith";
const MEMBER_EMAIL = "jo.smith@chapter.example.edu";
const SEARCH_URL =
  "https://api.frapp.live/v1/members/search?q=Jo%20Smith&limit=20";
const SEARCH_ORIGIN_AND_PATH = "https://api.frapp.live/v1/members/search";

/** The platform's `XMLHttpRequest`: answers 200 as soon as it is sent. */
class FakeXMLHttpRequest {
  readyState = 0;
  status = 0;
  private listeners: (() => void)[] = [];

  open(): void {
    this.readyState = 1;
  }

  setRequestHeader(): void {}

  addEventListener(type: string, listener: () => void): void {
    if (type === "readystatechange") this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === "readystatechange") {
      this.listeners = this.listeners.filter((entry) => entry !== listener);
    }
  }

  send(): void {
    this.readyState = 4;
    this.status = 200;
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * The platform's `fetch`, marked the way `expo/fetch` marks itself, which is
 * what makes React Native's integration record `fetch` crumbs at all.
 */
const expoFetch = Object.assign(
  async () => new Response(null, { status: 200 }),
  { [Symbol.for("expo.builtin")]: true },
);

let beforeBreadcrumb: ReactNativeOptions["beforeBreadcrumb"];
const client = {
  getOptions: () => ({ beforeBreadcrumb, maxBreadcrumbs: 100 }),
  getIntegrationByName: () => undefined,
  on: () => () => {},
  emit: () => {},
};

const realFetch = globalThis.fetch;
const realWarn = console.warn;

beforeAll(() => {
  // The instrumentation wraps what is installed when it is set up, so the
  // platform goes in first. The console's own output is silenced; the
  // breadcrumb handler still runs ahead of it.
  Object.assign(globalThis, {
    fetch: expoFetch,
    XMLHttpRequest: FakeXMLHttpRequest,
  });
  console.warn = vi.fn();
  breadcrumbsIntegration().setup?.(client as unknown as SdkClient);
});

afterAll(() => {
  Object.assign(globalThis, { fetch: realFetch });
  Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  console.warn = realWarn;
});

beforeEach(() => {
  sdkCore.setCurrentClient(client);
});

afterEach(() => {
  sdkCore.setCurrentClient(undefined);
  sdkCore.getIsolationScope().clear();
});

type Crumb = { category?: string; message?: string; data?: unknown };

/**
 * Runs `act` with `hook` as the client's `beforeBreadcrumb`. Returns what the
 * JS scope kept and what the native scope was sent.
 */
async function record(
  hook: ReactNativeOptions["beforeBreadcrumb"],
  act: () => unknown,
): Promise<{ js: Crumb[]; native: Crumb[] }> {
  beforeBreadcrumb = hook;
  native.breadcrumbs = [];
  // The SDK patches this scope once; `clear()` empties it without going
  // through the patched `clearBreadcrumbs`, so native is not asked to.
  const scope = sdkCore.getIsolationScope();
  scope.clear();
  enableSyncToNative(scope);

  await act();
  return {
    js: scope.getScopeData().breadcrumbs as Crumb[],
    native: native.breadcrumbs as Crumb[],
  };
}

function shippedBeforeBreadcrumb() {
  return buildMobileSentryOptions(DSN).beforeBreadcrumb;
}

const search = {
  fetch: () => fetch(SEARCH_URL),
  xhr: () => {
    const xhr = new FakeXMLHttpRequest() as unknown as XMLHttpRequest;
    xhr.open("GET", SEARCH_URL);
    xhr.send();
  },
};

describe("request breadcrumbs through the real SDK (#3104)", () => {
  it.each(Object.keys(search) as (keyof typeof search)[])(
    "records the %s search's query when no hook is set (the control)",
    async (kind) => {
      // Without this, the assertions below could pass on an integration that
      // stopped recording requests, or a URL the SDK stopped keeping.
      const { js, native: sent } = await record(undefined, search[kind]);

      expect(js).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        category: kind,
        data: { url: SEARCH_URL },
      });
    },
  );

  it.each(Object.keys(search) as (keyof typeof search)[])(
    "keeps the %s search's query out of the JS scope and the native scope",
    async (kind) => {
      const { js, native: sent } = await record(
        shippedBeforeBreadcrumb(),
        search[kind],
      );

      expect(js).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(JSON.stringify(js)).not.toContain("Jo");
      expect(JSON.stringify(sent)).not.toContain("Jo");
      expect(sent[0]).toMatchObject({
        category: kind,
        type: "http",
        data: { method: "GET", url: SEARCH_ORIGIN_AND_PATH, status_code: 200 },
      });
    },
  );
});

describe("console breadcrumbs through the real SDK (#3104)", () => {
  const warn = () =>
    console.warn("search failed for", MEMBER_EMAIL, {
      member: { name: MEMBER_NAME },
    });

  it("records the raw arguments when no hook is set (the control)", async () => {
    const { native: sent } = await record(undefined, warn);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ category: "console" });
    expect(JSON.stringify(sent[0]?.data)).toContain(MEMBER_NAME);
    expect(sent[0]?.message).toContain(MEMBER_EMAIL);
  });

  it("sends native no arguments and a swept message", async () => {
    const { js, native: sent } = await record(shippedBeforeBreadcrumb(), warn);

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(js)).not.toContain(MEMBER_NAME);
    expect(JSON.stringify(sent)).not.toContain(MEMBER_NAME);
    expect(JSON.stringify(sent)).not.toContain(MEMBER_EMAIL);
    expect(sent[0]?.data).toBeUndefined();
    expect(sent[0]).toMatchObject({
      category: "console",
      level: "warning",
      message: "search failed for [redacted:email] [object Object]",
    });
  });
});
