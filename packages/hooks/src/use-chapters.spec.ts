import type { components } from "@repo/api-sdk";
import type { SubscriptionStatus } from "@repo/validation";
import { describe, expectTypeOf, it } from "vitest";
import type { ChapterMembershipSummary } from "./use-chapters";

/**
 * `subscription_status` has one owner, `SubscriptionStatus` in
 * `@repo/validation` (#4152). These are type-level checks, enforced by
 * `check-types` (which compiles this file), not by `vitest run`.
 */
describe("ChapterMembershipSummary.chapter.subscription_status", () => {
  type Hook = ChapterMembershipSummary["chapter"]["subscription_status"];

  it("is the @repo/validation union", () => {
    expectTypeOf<Hook>().toEqualTypeOf<SubscriptionStatus>();
  });

  it("matches what the API contract publishes", () => {
    expectTypeOf<Hook>().toEqualTypeOf<
      components["schemas"]["CurrentChapterResponseDto"]["subscription_status"]
    >();
    expectTypeOf<Hook>().toEqualTypeOf<
      components["schemas"]["UpdateChapterResponseDto"]["subscription_status"]
    >();
  });
});
