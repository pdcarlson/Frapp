import { describe, expect, it } from "vitest";
import {
  resolveAuthGate,
  type AuthGateDestination,
  type AuthGateInput,
} from "./auth-gate";

/**
 * #764 / #957. Three properties matter here, and none is obvious from reading
 * the layouts: a member must never be parked on a screen they cannot act on,
 * the two gates must never redirect into each other, and a missing chapter
 * claim must never be fatal.
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
   * The outage guard, and the reason this file exists in its current shape.
   *
   * `custom_access_token_hook` is not enabled in production (#805), so no token
   * carries `active_chapter_id` today — and the API is fine with that, because
   * `ChapterGuard` auto-resolves a sole membership when neither the claim nor
   * `x-chapter-id` is present. A gate that demanded the claim would strand every
   * member on a picker that cannot possibly satisfy it, since activating a
   * chapter produces no claim while the hook is off. The rollback playbook also
   * prescribes disabling that hook during an auth incident, so this would fire
   * exactly when the app most needs to work.
   */
  it("lets a member through when the claim is absent but resolved", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        ...RESOLVED,
      }),
    ).toBe("tabs");
  });

  it("holds on the first read instead of painting the wrong thing", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        isChapterResolving: true,
      }),
    ).toBe("hold");
  });

  /**
   * A re-read must not blank the app. The claim is re-read on every token
   * change — the hourly auto-refresh and every foreground — and `hold` renders
   * nothing, so holding here would unmount the tab navigator about once an hour
   * and dump the member back on the Chat tab mid-use.
   */
  it("does not hold while re-resolving a chapter it already has", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        isChapterResolving: true,
      }),
    ).toBe("tabs");
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
  const tabsRedirects = (d: AuthGateDestination) => d === "sign-in";

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
      expect(["hold", "sign-in", "tabs"]).toContain(resolveAuthGate(state));
    }
  });

  /**
   * The cold-start flash. `chapterId` is null before the claim read finishes as
   * well as after it finds nothing, so a provider that seeded its resolving
   * flag `false` would produce one committed render of the post-read state
   * before the read had happened. That render must not be a redirect.
   */
  it("never redirects out of the tabs purely for a missing chapter", () => {
    for (const isChapterResolving of resolving) {
      expect(
        resolveAuthGate({
          status: "authenticated",
          chapterId: null,
          isChapterResolving,
        }),
      ).not.toBe("sign-in");
    }
  });
});
