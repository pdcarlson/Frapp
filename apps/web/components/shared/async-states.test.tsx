import { describe, it, expect } from "vitest";
import { hasNoCachedData } from "@/components/shared/async-states";

/**
 * The predicate behind every `isOffline && …` gate on the dashboard (#1621).
 *
 * These cases are written against the two ways a surface can hold nothing
 * truthful — a read that never resolved, and a read holding another query's
 * rows as placeholder data — because those are the two the call sites depend
 * on. `some` rather than `every` is the load-bearing choice: a surface needs
 * *all* of its reads to render honestly, so one uncached read is enough to
 * withhold it.
 */
describe("hasNoCachedData", () => {
  it("is false when every read is cached", () => {
    expect(hasNoCachedData({ data: [] }, { data: { balance: 0 } })).toBe(false);
  });

  it("is true when any single read is uncached", () => {
    expect(hasNoCachedData({ data: undefined })).toBe(true);
  });

  it("is true when one of several reads is uncached", () => {
    // Pins `some`, not `every`: swapping them makes this case false.
    expect(
      hasNoCachedData({ data: [] }, { data: undefined }, { data: [] }),
    ).toBe(true);
  });

  it("treats placeholder data as uncached", () => {
    // `useAlumni`'s `keepPreviousData` shape: `data` is defined, but it is the
    // previous filter's rows rather than this query's answer.
    expect(hasNoCachedData({ data: [{ id: "a" }], isPlaceholderData: true })).toBe(
      true,
    );
  });

  it("does not treat settled data as placeholder", () => {
    expect(
      hasNoCachedData({ data: [{ id: "a" }], isPlaceholderData: false }),
    ).toBe(false);
  });

  it("distinguishes an empty answer from no answer", () => {
    // A loaded-and-genuinely-empty read is cached. Collapsing this to
    // `!read.data` would make `[]`, `0` and `""` read as uncached and withhold
    // a page that has a correct empty state to show.
    expect(hasNoCachedData({ data: [] })).toBe(false);
    expect(hasNoCachedData({ data: null })).toBe(false);
  });

  it("withholds nothing when a surface declares no reads", () => {
    expect(hasNoCachedData()).toBe(false);
  });
});
