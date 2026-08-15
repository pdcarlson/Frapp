import { describe, expect, it } from "vitest";
import {
  resolveAuthGate,
  type AuthGateDestination,
  type AuthGateInput,
} from "./auth-gate";

/**
 * #764 / #957. Two properties matter here and neither is obvious from reading
 * the layouts: a member must never be parked on a screen they cannot act on,
 * and the two gates must never redirect into each other.
 */

const RESOLVED = { isChapterResolving: false } as const;

describe("resolveAuthGate", () => {
  it("holds while the session is hydrating", () => {
    expect(
      resolveAuthGate({
        status: "hydrating",
        chapterId: null,
        isChapterResolving: false,
      }),
    ).toBe("hold");
  });

  it("sends a signed-out member to sign-in", () => {
    expect(
      resolveAuthGate({
        status: "unauthenticated",
        chapterId: null,
        ...RESOLVED,
      }),
    ).toBe("sign-in");
  });

  it("sends a member with a resolved chapter into the tabs", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        ...RESOLVED,
      }),
    ).toBe("tabs");
  });

  /**
   * The single-chapter branch of #764's acceptance criteria. Such a member
   * always carries a claim, because `custom_access_token_hook` resolves a sole
   * membership server-side — so the picker is unreachable for them, which is
   * what "never sees the picker" means at the routing layer.
   */
  it("never routes a member who has a chapter to the picker", () => {
    for (const chapterId of ["chapter-a", "00000000-0000-0000-0000-000000000001"]) {
      expect(
        resolveAuthGate({ status: "authenticated", chapterId, ...RESOLVED }),
      ).not.toBe("picker");
    }
  });

  /** The multi-chapter branch: no claim, so the picker is the only way on. */
  it("routes an authenticated member with no chapter to the picker", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        ...RESOLVED,
      }),
    ).toBe("picker");
  });

  it("holds instead of showing the picker while the claim is still resolving", () => {
    // The regression this pins: `chapterId` is null during the read too, so a
    // gate that ignored `isChapterResolving` would flash the picker at every
    // cold start for members who have a perfectly good chapter.
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        isChapterResolving: true,
      }),
    ).toBe("hold");

    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        isChapterResolving: true,
      }),
    ).toBe("hold");
  });
});

describe("the two layouts cannot loop", () => {
  const statuses = ["hydrating", "authenticated", "unauthenticated"] as const;
  const chapterIds = [null, "chapter-a"];
  const resolving = [true, false];

  const everyState: AuthGateInput[] = statuses.flatMap((status) =>
    chapterIds.flatMap((chapterId) =>
      resolving.map((isChapterResolving) => ({
        status,
        chapterId,
        isChapterResolving,
      })),
    ),
  );

  // How each layout reacts to a destination. `(auth)` redirects only when the
  // answer is outside its group, and `(tabs)` only when it is inside `(auth)`.
  const authRedirects = (d: AuthGateDestination) => d === "tabs";
  const tabsRedirects = (d: AuthGateDestination) =>
    d === "sign-in" || d === "picker";

  it("never has both gates redirecting for the same state", () => {
    for (const state of everyState) {
      const destination = resolveAuthGate(state);
      expect(
        authRedirects(destination) && tabsRedirects(destination),
        `both gates redirect for ${JSON.stringify(state)}`,
      ).toBe(false);
    }
  });

  it("resolves every reachable state to exactly one destination", () => {
    for (const state of everyState) {
      expect(["hold", "sign-in", "picker", "tabs"]).toContain(
        resolveAuthGate(state),
      );
    }
  });
});
