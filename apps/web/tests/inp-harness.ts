/**
 * Drives one INP measurement through the real browser SDK under jsdom, and
 * records every envelope the SDK sends (#2736).
 *
 * jsdom has no event timing, so this stands in for the browser's half only:
 * a `PerformanceEventTiming` with `interactionId` (web-vitals' feature test),
 * and a `PerformanceObserver` that hands observers one slow click. From
 * there it is web-vitals' own `onINP` and the SDK's own INP span, envelope
 * and `beforeEnvelope` hook.
 *
 * Install it **before** `Sentry.init`: web-vitals feature-tests the globals
 * when the SDK starts observing. One SDK init per spec file, because the SDK
 * and web-vitals keep module state across inits.
 */

type ObserverCallback = (list: { getEntries(): unknown[] }) => void;

export type Envelope = [
  Record<string, unknown>,
  [Record<string, unknown>, unknown][],
];

export type StreamedSpan = {
  name: string;
  attributes: Record<string, { value: unknown }>;
};

const eventObservers: ObserverCallback[] = [];

/** Just enough of `PerformanceObserver` for web-vitals and the SDK. */
class FakePerformanceObserver {
  static supportedEntryTypes = ["event", "first-input"];
  constructor(private readonly callback: ObserverCallback) {}
  observe({ type }: { type: string }) {
    if (type === "event") eventObservers.push(this.callback);
  }
  disconnect() {}
  takeRecords() {
    return [];
  }
}

export function installEventTiming(stubGlobal: (name: string, value: unknown) => void) {
  class PerformanceEventTiming {}
  Object.defineProperty(PerformanceEventTiming.prototype, "interactionId", {
    value: 0,
  });
  stubGlobal("PerformanceEventTiming", PerformanceEventTiming);
  stubGlobal("PerformanceObserver", FakePerformanceObserver);
}

/** Let queued microtasks and zero-delay timers run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A button labelled like `channel-list.tsx`'s hide control. */
export function labelledButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "rounded-md px-2";
  button.setAttribute("aria-label", label);
  document.body.appendChild(button);
  return button;
}

/**
 * The selector `labelledButton` gets from the SDK once its label value is
 * removed.
 */
export const REDUCED_BUTTON_SELECTOR = "body > button.rounded-md.px-2[aria-label]";

/**
 * One 240 ms click on `target`, then the page going hidden, which is when
 * web-vitals reports INP.
 */
export async function slowClickThenHide(target: Element): Promise<void> {
  const entry = {
    entryType: "event",
    name: "click",
    interactionId: 7,
    startTime: 100,
    duration: 240,
    processingStart: 110,
    processingEnd: 300,
    target,
  };
  for (const callback of eventObservers) {
    callback({ getEntries: () => [entry] });
  }
  await settle();
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * A transport that sends nothing, and the envelopes it was handed.
 *
 * `snapshot` is an integration whose `beforeEnvelope` listener records each
 * envelope as the SDK built it. Put it **ahead of** the scrubbing
 * integration: it is the control, and it only shows the raw envelope if it
 * runs first.
 */
function createEnvelopeRecorder() {
  const built: string[] = [];
  const sent: Envelope[] = [];
  return {
    built,
    sent,
    snapshot: {
      name: "EnvelopeSnapshot",
      setup(client: {
        on(hook: "beforeEnvelope", callback: (envelope: unknown) => void): unknown;
      }) {
        client.on("beforeEnvelope", (envelope) => {
          built.push(JSON.stringify(envelope));
        });
      },
    },
    transport: () => ({
      send: (envelope: unknown) => {
        sent.push(envelope as Envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
    /** Every sent item of one type, with its envelope's header. */
    itemsOfType<T>(type: string): { header: Record<string, unknown>; payload: T }[] {
      return sent.flatMap(([header, items]) =>
        items
          .filter(([itemHeader]) => itemHeader.type === type)
          .map(([, payload]) => ({ header, payload: payload as T })),
      );
    },
  };
}

/**
 * This spec file's recorder. One per file, like the SDK init it records: a
 * `vi.mock` factory and the spec body both import this module and get the
 * same instance.
 */
export const envelopeRecorder = createEnvelopeRecorder();

/** The `@sentry/nextjs` client build, by path. */
export async function importSentryClientBuild(): Promise<
  typeof import("@sentry/nextjs")
> {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  // The package's `exports` resolve the server build under vitest, and it
  // has no browser tracing.
  const clientBuild = join(
    dirname(createRequire(import.meta.url).resolve("@sentry/nextjs/package.json")),
    "build/cjs/index.client.js",
  );
  const { vi } = await import("vitest");
  return vi.importActual<typeof import("@sentry/nextjs")>(clientBuild);
}
