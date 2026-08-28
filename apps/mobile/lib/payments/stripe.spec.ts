import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted`, because the factory below is lifted to the top of the file —
// the pattern `lib/keyboard.spec.ts` established for the sibling module.
const constantsState = vi.hoisted(() => ({
  executionEnvironment: "bare",
}));

vi.mock("expo-constants", () => ({
  default: {
    get executionEnvironment() {
      return constantsState.executionEnvironment;
    },
  },
  ExecutionEnvironment: {
    Bare: "bare",
    Standalone: "standalone",
    StoreClient: "storeClient",
  },
}));

import type { StripeModule } from "./stripe-types";
import {
  isStripeAvailable,
  presentPaymentSheet,
  publishableKey,
  setStripeLoaderForTests,
  stripeUnavailableReason,
} from "./stripe";

function fakeStripe(overrides: Record<string, unknown> = {}) {
  return {
    initStripe: vi.fn().mockResolvedValue({}),
    initPaymentSheet: vi.fn().mockResolvedValue({}),
    presentPaymentSheet: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as StripeModule & {
    initStripe: ReturnType<typeof vi.fn>;
    initPaymentSheet: ReturnType<typeof vi.fn>;
    presentPaymentSheet: ReturnType<typeof vi.fn>;
  };
}

const KEY = "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY";

beforeEach(() => {
  constantsState.executionEnvironment = "bare";
  process.env[KEY] = "pk_test_123";
});

afterEach(() => {
  setStripeLoaderForTests(null);
  delete process.env[KEY];
});

describe("the platform split", () => {
  it("never requires the package on the web/default half", async () => {
    // This is the contract that keeps `npx expo export --platform web` alive:
    // that export statically renders every screen under Node, and a `require`
    // of Stripe there aborts it with "__fbBatchedBridgeConfig is not set"
    // before any runtime guard can run. Vitest resolves `./stripe-module` to
    // the same default half the web bundle gets.
    const { requireStripe } = await import("./stripe-module");
    expect(requireStripe()).toBeNull();
  });
});

describe("isStripeAvailable", () => {
  it("is true only with both the native module and a key", () => {
    setStripeLoaderForTests(() => fakeStripe());
    expect(isStripeAvailable()).toBe(true);
  });

  it("is false in Expo Go, without ever loading the module", () => {
    // The whole point of the isolation module: importing the package in Go
    // crashes it at launch, so the guard must short-circuit before the loader.
    const loader = vi.fn(() => fakeStripe());
    constantsState.executionEnvironment = "storeClient";
    setStripeLoaderForTests(loader);

    expect(isStripeAvailable()).toBe(false);
    expect(loader).not.toHaveBeenCalled();
  });

  it("is false with no publishable key, matching the web precedent", () => {
    setStripeLoaderForTests(() => fakeStripe());
    delete process.env[KEY];
    expect(publishableKey()).toBeNull();
    expect(isStripeAvailable()).toBe(false);
  });

  it("is false when the native module fails to link", () => {
    setStripeLoaderForTests(() => {
      throw new Error("no native module");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(isStripeAvailable()).toBe(false);
    // A link failure outside Go is a real problem and must not be silent.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("stripeUnavailableReason", () => {
  it("names the build, not the configuration, in Expo Go", () => {
    constantsState.executionEnvironment = "storeClient";
    setStripeLoaderForTests(() => fakeStripe());
    expect(stripeUnavailableReason()).toContain("installed Frapp build");
  });

  it("names the configuration when only the key is missing", () => {
    setStripeLoaderForTests(() => fakeStripe());
    delete process.env[KEY];
    expect(stripeUnavailableReason()).toContain("aren't switched on");
  });

  it("is null when payment is available, so the control has no excuse to show", () => {
    setStripeLoaderForTests(() => fakeStripe());
    expect(stripeUnavailableReason()).toBeNull();
  });
});

describe("presentPaymentSheet", () => {
  const input = { clientSecret: "pi_1_secret", merchantDisplayName: "Frapp" };

  it("initialises with the publishable key and the minted intent", async () => {
    const stripe = fakeStripe();
    setStripeLoaderForTests(() => stripe);

    await expect(presentPaymentSheet(input)).resolves.toEqual({
      kind: "completed",
    });
    expect(stripe.initStripe).toHaveBeenCalledWith({
      publishableKey: "pk_test_123",
    });
    expect(stripe.initPaymentSheet).toHaveBeenCalledWith({
      merchantDisplayName: "Frapp",
      paymentIntentClientSecret: "pi_1_secret",
    });
  });

  it("reports a dismissed sheet as cancelled, not as a failure", () => {
    // Stripe reports a dismissal as an error with code `Canceled`. Rendering
    // that in red puts a fault under a member who simply changed their mind.
    const stripe = fakeStripe({
      presentPaymentSheet: vi
        .fn()
        .mockResolvedValue({ error: { code: "Canceled", message: "Canceled" } }),
    });
    setStripeLoaderForTests(() => stripe);

    return expect(presentPaymentSheet(input)).resolves.toEqual({
      kind: "canceled",
    });
  });

  it("carries the provider's own decline message through", () => {
    const stripe = fakeStripe({
      presentPaymentSheet: vi.fn().mockResolvedValue({
        error: { code: "Failed", message: "Your card was declined." },
      }),
    });
    setStripeLoaderForTests(() => stripe);

    return expect(presentPaymentSheet(input)).resolves.toEqual({
      kind: "failed",
      message: "Your card was declined.",
    });
  });

  it("fails with the init error rather than opening an unusable sheet", async () => {
    const stripe = fakeStripe({
      initPaymentSheet: vi
        .fn()
        .mockResolvedValue({ error: { message: "Intent already succeeded" } }),
    });
    setStripeLoaderForTests(() => stripe);

    await expect(presentPaymentSheet(input)).resolves.toEqual({
      kind: "failed",
      message: "Intent already succeeded",
    });
    expect(stripe.presentPaymentSheet).not.toHaveBeenCalled();
  });

  it("refuses without crashing when Stripe is unavailable", async () => {
    constantsState.executionEnvironment = "storeClient";
    const result = await presentPaymentSheet(input);
    expect(result.kind).toBe("failed");
  });
});
