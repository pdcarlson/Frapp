import { afterEach, describe, expect, it, vi } from "vitest";
import { createIsolatedModule } from "./isolated-module";

/**
 * The loader factory the four isolation modules share.
 *
 * Each of `lib/keyboard.tsx`, `lib/apple-auth.ts`, `lib/notifications/push.ts`
 * and `lib/payments/stripe.ts` has its own spec covering its own guard and
 * wrappers. What those specs cannot state once is the machinery underneath, so
 * it is stated here: the caching contract, the never-invoke-when-guarded rule
 * (the Expo Go crash-prevention property), the warn-and-degrade path, and the
 * test seam's reset semantics.
 */

type FakeModule = { id: string };

/** The factory under test, with only the fields a case actually varies. */
function makeModule(
  load: () => FakeModule | null,
  options?: { whenUnavailable?: string; isUnavailable?: () => boolean },
) {
  return createIsolatedModule<FakeModule>({
    packageName: "fake-package",
    whenUnavailable: options?.whenUnavailable ?? "nothing happens.",
    load,
    isUnavailable: options?.isUnavailable,
  });
}

/**
 * The caching contract for an unavailable module, asserted the same way from
 * the two cases that reach it — a loader that returns `null` and one that
 * throws. Both must serve `null` without re-running the loader.
 */
function expectUnavailableAndLoadedOnce(
  mod: { load: () => FakeModule | null },
  load: () => FakeModule | null,
) {
  expect(mod.load()).toBeNull();
  expect(mod.load()).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createIsolatedModule", () => {
  it("loads once and caches the module across calls", () => {
    const load = vi.fn((): FakeModule => ({ id: "real" }));
    const mod = makeModule(load);

    expect(mod.load()).toEqual({ id: "real" });
    expect(mod.load()).toEqual({ id: "real" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("caches an unavailable result too, so a missing package is required once", () => {
    const load = vi.fn((): FakeModule | null => null);
    const mod = makeModule(load);

    expectUnavailableAndLoadedOnce(mod, load);
  });

  it("never invokes the loader when the guard says unavailable", () => {
    const load = vi.fn((): FakeModule => ({ id: "real" }));
    const mod = makeModule(load, { isUnavailable: () => true });

    expect(mod.load()).toBeNull();
    // The crash-prevention property itself: in Expo Go the package must never
    // be loaded, not merely reported as unavailable.
    expect(load).not.toHaveBeenCalled();
  });

  it("reads the guard lazily, not at creation time", () => {
    let unavailable = true;
    const load = vi.fn((): FakeModule => ({ id: "real" }));
    const mod = makeModule(load, { isUnavailable: () => unavailable });

    unavailable = false;
    expect(mod.load()).toEqual({ id: "real" });
  });

  it("degrades to null and warns with the module's own sentence when the load throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom = new Error("linking failure");
    const mod = makeModule(
      () => {
        throw boom;
      },
      { whenUnavailable: "the pay path stays disabled." },
    );

    expect(mod.load()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "fake-package failed to load; the pay path stays disabled.",
      boom,
    );
  });

  it("does not retry a throwing loader", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const load = vi.fn((): FakeModule => {
      throw new Error("linking failure");
    });
    const mod = makeModule(load);

    expectUnavailableAndLoadedOnce(mod, load);
  });

  it("swaps the loader and drops the cached attempt via the test seam", () => {
    const real = vi.fn((): FakeModule => ({ id: "real" }));
    const mod = makeModule(real);

    expect(mod.load()).toEqual({ id: "real" });

    mod.setLoaderForTests(() => ({ id: "fake" }));
    expect(mod.load()).toEqual({ id: "fake" });

    // `null` restores the real loader, and drops the cache again — otherwise a
    // spec that reset in `beforeEach` would keep serving the previous fake.
    mod.setLoaderForTests(null);
    expect(mod.load()).toEqual({ id: "real" });
    expect(real).toHaveBeenCalledTimes(2);
  });

  it("still guards after the test seam swaps the loader", () => {
    const load = vi.fn((): FakeModule => ({ id: "real" }));
    const mod = makeModule(load, { isUnavailable: () => true });

    // The order all four real specs use: inject a fake, *then* load under the
    // guard. The seam must not become an override — "the loader the test asked
    // for always wins" is a plausible change that would keep every other case
    // in this file green while re-opening the Expo Go crash.
    const injected = vi.fn((): FakeModule => ({ id: "fake" }));
    mod.setLoaderForTests(injected);

    expect(mod.load()).toBeNull();
    expect(injected).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("works when its methods are detached from the object", () => {
    // Every production site detaches both — `const loadStripe =
    // stripeModule.load`, `export const setPushLoaderForTests =
    // notifications.setLoaderForTests`. That only holds while the
    // implementation touches closure variables and never `this`, so pin it:
    // rewriting this factory as a class would keep every other case here green
    // and throw `TypeError` on first render inside Expo Go, outside the
    // `try`/`catch`, which is the one failure the subsystem exists to prevent.
    const mod = makeModule(() => ({ id: "real" }));
    const load = mod.load;
    const setLoaderForTests = mod.setLoaderForTests;

    expect(load()).toEqual({ id: "real" });
    setLoaderForTests(() => ({ id: "fake" }));
    expect(load()).toEqual({ id: "fake" });
  });

  it("treats a loader that returns undefined as unavailable, and caches it", () => {
    // `undefined` is this cache's "not yet attempted" sentinel. Storing it
    // would re-invoke the loader forever and return `undefined` to callers
    // whose availability test is `!== null` — an enabled Pay button with no
    // native module behind it. `vi.fn()` with no implementation is exactly
    // that loader, and it type-checks at every real call site.
    const load = vi.fn() as unknown as () => FakeModule | null;
    const mod = makeModule(load);

    expectUnavailableAndLoadedOnce(mod, load);
  });

  it("keeps each created module's cache to itself", () => {
    const a = makeModule(() => ({ id: "a" }));
    const b = makeModule(() => ({ id: "b" }));

    a.setLoaderForTests(() => ({ id: "swapped" }));

    expect(a.load()).toEqual({ id: "swapped" });
    expect(b.load()).toEqual({ id: "b" });
  });
});
