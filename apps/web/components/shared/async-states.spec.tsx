import { describe, it, expect } from "vitest";
import { anyReadUncached } from "@/components/shared/async-states";

/**
 * The predicate behind every `isOffline && …` gate on the dashboard (#1621).
 *
 * These cases are written against the two ways a surface can hold nothing
 * truthful — a read that never resolved, and a read holding another query's
 * rows as placeholder data — because those are the two the call sites depend
 * on. `some` rather than `every` is the load-bearing choice: a surface needs
 * *all* of its reads to render honestly, so one uncached read is enough to
 * withhold it — which is what the name says, so these cases pin the behaviour
 * rather than having to correct a reading of it.
 *
 * The zero-argument case is pinned by the type system rather than at runtime,
 * so it is asserted here with `@ts-expect-error` instead of an `expect`: a
 * surface declaring no reads is a mistake to make unrepresentable, not a
 * behaviour to define. `apps/web/tsconfig.json` includes every `.tsx` in the
 * app with only `node_modules` excluded, so these lines are checked by
 * `check-types` in CI — and because `@ts-expect-error` fails when the error it
 * expects is *absent*, widening the signature back to `readonly CachedRead[]`
 * turns this file red rather than passing silently.
 */
describe("anyReadUncached", () => {
  it("is false when every read is cached", () => {
    expect(anyReadUncached({ data: [] }, { data: { balance: 0 } })).toBe(false);
  });

  it("is true when any single read is uncached", () => {
    expect(anyReadUncached({ data: undefined })).toBe(true);
  });

  it("is true when one of several reads is uncached", () => {
    // Pins `some`, not `every`: swapping them makes this case false.
    expect(
      anyReadUncached({ data: [] }, { data: undefined }, { data: [] }),
    ).toBe(true);
  });

  it("treats placeholder data as uncached", () => {
    // `useAlumni`'s `keepPreviousData` shape: `data` is defined, but it is the
    // previous filter's rows rather than this query's answer.
    expect(anyReadUncached({ data: [{ id: "a" }], isPlaceholderData: true })).toBe(
      true,
    );
  });

  it("does not treat settled data as placeholder", () => {
    expect(
      anyReadUncached({ data: [{ id: "a" }], isPlaceholderData: false }),
    ).toBe(false);
  });

  it("does not accept a call that declares no reads", () => {
    // @ts-expect-error - the first read is a required tuple member (TS2555).
    expect(() => anyReadUncached()).not.toThrow();
    // Declared inline rather than importing the module's `CachedRead`, which
    // is deliberately not exported — a test should not widen a public surface.
    const spread: { data: unknown }[] = [{ data: [] }];
    // @ts-expect-error - a non-tuple spread cannot satisfy it either (TS2556).
    expect(anyReadUncached(...spread)).toBe(false);
  });

  it("distinguishes an empty answer from no answer", () => {
    // A loaded-and-genuinely-empty read is cached. Collapsing this to
    // `!read.data` would make `[]`, `0` and `""` read as uncached and withhold
    // a page that has a correct empty state to show.
    expect(anyReadUncached({ data: [] })).toBe(false);
    expect(anyReadUncached({ data: null })).toBe(false);
  });
});
