import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  envelopeRecorder,
  installEventTiming,
  labelledButton,
  REDUCED_BUTTON_SELECTOR,
  settle,
  slowClickThenHide,
  type StreamedSpan,
} from "./tests/inp-harness";

/**
 * INP and `ui.click` through the real SDK, as `instrumentation-client.ts`
 * ships it, read at the transport (#2736).
 *
 * The file under test runs on the real `@sentry/nextjs` client build with
 * only its transport swapped, and with a snapshot listener ahead of the
 * scrubber. The snapshot is the control: it must show the member's name, or
 * the rest proves nothing. `tests/inp-harness.ts` supplies the browser's
 * event timing, which jsdom lacks.
 *
 * `lib/sentry/inp-trace-root.envelope.spec.ts` covers the other shape: an
 * INP span that roots its own trace, whose selector is also the envelope's
 * `trace.transaction` header.
 */

const MEMBER_NAME = "Jo Smith";
const LABEL = `Hide conversation with ${MEMBER_NAME}`;

vi.mock("@sentry/nextjs", async () => {
  const { envelopeRecorder: recorder, importSentryClientBuild } = await import(
    "./tests/inp-harness"
  );
  const actual = await importSentryClientBuild();
  const init = (options: { integrations: unknown[] }) =>
    actual.init({
      ...(options as Parameters<typeof actual.init>[0]),
      integrations: [recorder.snapshot, ...options.integrations] as never,
      transport: recorder.transport,
    });
  // The real module with only `init` swapped. A spread would not copy the
  // CJS build's exports, which are getters.
  return new Proxy(actual, {
    get: (target, key, receiver) =>
      key === "init" ? init : Reflect.get(target, key, receiver),
  });
});
vi.mock("@/lib/posthog/client", () => ({ initWebPostHog: vi.fn() }));

describe("web Sentry on the wire", () => {
  beforeAll(async () => {
    installEventTiming(vi.stubGlobal);
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://fixturekey@o0.ingest.example.invalid/1",
    );
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "1");
    window.history.replaceState({}, "", "/chat");

    await import("./instrumentation-client");
    const Sentry = await import("@sentry/nextjs");
    await settle();

    const button = labelledButton(LABEL);
    button.click();
    await slowClickThenHide(button);

    Sentry.captureException(new Error("send failed"));
    await Sentry.flush(1000);
  });

  afterAll(async () => {
    const Sentry = await import("@sentry/nextjs");
    await Sentry.close(0);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds an INP envelope carrying the label (the control)", () => {
    const built = envelopeRecorder.built.find((envelope) =>
      envelope.includes('"type":"span"'),
    );
    expect(built).toBeDefined();
    expect(built).toContain(LABEL);
    expect(built).toContain("user_agent.original");
  });

  it("sends nothing carrying the label", () => {
    const wire = JSON.stringify(envelopeRecorder.sent);
    expect(wire).not.toContain(MEMBER_NAME);
    expect(wire).not.toContain("user_agent.original");
  });

  it("still sends INP's op and value, under the reduced selector", () => {
    const [inp] = envelopeRecorder.itemsOfType<{ items: StreamedSpan[] }>("span");
    expect(inp).toBeDefined();
    const span = inp!.payload.items[0]!;

    expect(span.name).toBe(REDUCED_BUTTON_SELECTOR);
    expect(span.attributes["sentry.op"]?.value).toBe("ui.interaction.click");
    expect(span.attributes["browser.web_vital.inp.value"]?.value).toBe(240);
    expect(span.attributes["browser.web_vital.inp.target"]?.value).toBe(
      REDUCED_BUTTON_SELECTOR,
    );

    // The header keeps its sampling context.
    const trace = inp!.header.trace as Record<string, unknown>;
    expect(trace.trace_id).toEqual(expect.any(String));
    expect(trace.public_key).toBe("fixturekey");
  });

  it("sends the click breadcrumb with the reduced selector", () => {
    const [event] = envelopeRecorder.itemsOfType<{
      breadcrumbs?: { category?: string; message?: string }[];
    }>("event");
    expect(event).toBeDefined();
    expect(event!.payload.breadcrumbs).toContainEqual(
      expect.objectContaining({
        category: "ui.click",
        message: REDUCED_BUTTON_SELECTOR,
      }),
    );
  });
});
