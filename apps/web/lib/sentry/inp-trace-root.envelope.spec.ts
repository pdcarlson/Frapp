import { sentryEnvelopeScrubIntegration } from "@repo/observability/next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  envelopeRecorder,
  importSentryClientBuild,
  installEventTiming,
  labelledButton,
  REDUCED_BUTTON_SELECTOR,
  settle,
  slowClickThenHide,
  type StreamedSpan,
} from "../../tests/inp-harness";
import { buildWebSentryOptions } from "./options";

/**
 * An INP span that roots its own trace, through the real SDK (#2736).
 *
 * With no pageload or navigation span to hang from, the SDK makes the INP
 * span its own segment. Its selector is then also the segment name and,
 * because the envelope's Dynamic Sampling Context is built from that
 * segment, the envelope's `trace.transaction` header, which no event hook
 * can reach. `instrumentation-client.envelope.spec.ts` covers the app's own
 * wiring, where INP usually hangs from the pageload; this covers the shape
 * whose header leaked.
 *
 * Options are the app's (`buildWebSentryOptions`), with page-load and
 * navigation instrumentation off so no span is active when the click lands.
 */

const MEMBER_NAME = "Jo Smith";
const LABEL = `Hide conversation with ${MEMBER_NAME}`;

describe("an INP span that roots its own trace", () => {
  let Sentry: Awaited<ReturnType<typeof importSentryClientBuild>>;

  beforeAll(async () => {
    installEventTiming(vi.stubGlobal);
    window.history.replaceState({}, "", "/chat");
    Sentry = await importSentryClientBuild();
    Sentry.init({
      ...buildWebSentryOptions("https://fixturekey@o0.ingest.example.invalid/1"),
      tracesSampleRate: 1,
      integrations: [
        envelopeRecorder.snapshot,
        Sentry.browserTracingIntegration({
          instrumentPageLoad: false,
          instrumentNavigation: false,
        }),
        sentryEnvelopeScrubIntegration(),
      ] as never,
      transport: envelopeRecorder.transport,
    });
    await settle();

    await slowClickThenHide(labelledButton(LABEL));
    await Sentry.flush(1000);
  });

  afterAll(async () => {
    await Sentry.close(0);
    vi.unstubAllGlobals();
  });

  it("builds the label into the header (the control)", () => {
    const [built] = envelopeRecorder.built;
    expect(built).toBeDefined();
    const [header] = JSON.parse(built!) as [{ trace: { transaction?: string } }];
    expect(header.trace.transaction).toContain(LABEL);
  });

  it("sends the header, name and attributes without it", () => {
    expect(JSON.stringify(envelopeRecorder.sent)).not.toContain(MEMBER_NAME);

    const [inp] = envelopeRecorder.itemsOfType<{ items: StreamedSpan[] }>("span");
    expect(inp).toBeDefined();
    const trace = inp!.header.trace as Record<string, unknown>;
    expect(trace.transaction).toBe(REDUCED_BUTTON_SELECTOR);

    const span = inp!.payload.items[0]!;
    expect(span.name).toBe(REDUCED_BUTTON_SELECTOR);
    expect(span.attributes["sentry.segment.name"]?.value).toBe(
      REDUCED_BUTTON_SELECTOR,
    );
    expect(span.attributes["sentry.op"]?.value).toBe("ui.interaction.click");
    expect(span.attributes["browser.web_vital.inp.value"]?.value).toBe(240);
  });

  it("sends the page URL as a path", () => {
    const [built] = envelopeRecorder.built;
    expect(built).toContain("http://localhost:3000/chat");

    const [inp] = envelopeRecorder.itemsOfType<{ items: StreamedSpan[] }>("span");
    expect(inp!.payload.items[0]!.attributes["url.full"]?.value).toBe("/chat");
  });
});
