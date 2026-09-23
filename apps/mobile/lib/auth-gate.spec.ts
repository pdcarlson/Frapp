import { describe, expect, it } from "vitest";
import {
  legalReadStatus,
  resolveAuthGate,
  type AuthGateDestination,
  type AuthGateInput,
} from "./auth-gate";

/**
 * #764 / #957 / #958. Four properties matter here, and none is obvious from
 * reading the layouts: a member must never be parked on a screen they cannot
 * act on, the two gates must never redirect into each other, a missing chapter
 * claim must never be fatal, and `has_completed_onboarding` must actually send
 * a new member to s03.
 */

const RESOLVED = { isChapterResolving: false } as const;
const NO_MEMBERSHIPS = {
  membershipsStatus: "idle" as const,
  memberships: [] as AuthGateInput["memberships"],
};

const incomplete = {
  membershipsStatus: "success" as const,
  memberships: [
    { chapter_id: "chapter-a", has_completed_onboarding: false },
  ],
};

const complete = {
  membershipsStatus: "success" as const,
  memberships: [
    { chapter_id: "chapter-a", has_completed_onboarding: true },
  ],
};

const emptyMemberships = {
  membershipsStatus: "success" as const,
  memberships: [] as AuthGateInput["memberships"],
};

describe("resolveAuthGate", () => {
  it("holds while the session is hydrating", () => {
    expect(
      resolveAuthGate({
        status: "hydrating",
        chapterId: null,
        isChapterResolving: false,
        ...NO_MEMBERSHIPS,
      }),
    ).toBe("hold");
  });

  it("sends a signed-out member to sign-in", () => {
    expect(
      resolveAuthGate({
        status: "unauthenticated",
        chapterId: null,
        ...RESOLVED,
        ...NO_MEMBERSHIPS,
      }),
    ).toBe("sign-in");
  });

  it("sends a member who has finished onboarding into the tabs", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        ...RESOLVED,
        ...complete,
      }),
    ).toBe("tabs");
  });

  /**
   * The outage guard, and the reason this file exists in its current shape.
   *
   * `custom_access_token_hook` is enabled on both hosted projects, but a token
   * still has no `active_chapter_id` when the user has no membership — and the
   * API is fine with that, because `ChapterGuard` auto-resolves a sole
   * membership when neither the claim nor `x-chapter-id` is present. A gate that
   * demanded the claim would strand every member on a picker that cannot
   * possibly satisfy it whenever the claim is absent (no chapter yet, or the
   * rollback playbook has disabled the hook during an auth incident).
   *
   * Memberships still decide join vs welcome vs tabs. A missing *claim* with a
   * completed sole membership is tabs, not the picker.
   */
  it("lets a finished member through when the claim is absent but resolved", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        ...RESOLVED,
        ...complete,
      }),
    ).toBe("tabs");
  });

  it("holds on the first claim read instead of painting the wrong thing", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        isChapterResolving: true,
        ...NO_MEMBERSHIPS,
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
        ...complete,
      }),
    ).toBe("tabs");
  });

  it("holds while the chapters list for an authenticated session is loading", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        ...RESOLVED,
        membershipsStatus: "pending",
        memberships: [],
      }),
    ).toBe("hold");
  });

  it("sends a member with no memberships to join", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        ...RESOLVED,
        ...emptyMemberships,
      }),
    ).toBe("join");
  });

  it("sends a new member to the first-run screen", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        ...RESOLVED,
        ...incomplete,
      }),
    ).toBe("welcome");
  });

  it("sends a sole incomplete membership to welcome even without a claim", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: null,
        ...RESOLVED,
        ...incomplete,
      }),
    ).toBe("welcome");
  });

  it("fails open to tabs when the chapters read errors", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        ...RESOLVED,
        membershipsStatus: "error",
        memberships: [],
      }),
    ).toBe("tabs");
  });

  /**
   * `(tabs)/_layout.tsx` is frozen and still calls this with only the session.
   * Those omitted fields must not hold the tab navigator forever, and must not
   * type-error the hotspot file. AppRuntime is the one that then walks a new
   * member out onto s02/s03.
   */
  it("lets the frozen tabs layout omit memberships and still reach tabs", () => {
    expect(
      resolveAuthGate({
        status: "authenticated",
        chapterId: "chapter-a",
        isChapterResolving: false,
      }),
    ).toBe("tabs");
  });
});

/**
 * #2302. A member who hasn't accepted the Terms the server enforces is asked
 * before anything else they can reach, and the read that decides it can never
 * lock anyone out.
 */
describe("resolveAuthGate — the Terms prompt (#2302)", () => {
  const member = {
    status: "authenticated" as const,
    chapterId: "chapter-a",
    ...RESOLVED,
  };

  it("asks a member who hasn't accepted the current Terms", () => {
    expect(
      resolveAuthGate({
        ...member,
        ...complete,
        legalAcceptanceStatus: "success",
        legalAcceptanceRequired: true,
      }),
    ).toBe("terms");
  });

  it("asks before first-run, so a new member agrees before they post", () => {
    expect(
      resolveAuthGate({
        ...member,
        ...incomplete,
        legalAcceptanceStatus: "success",
        legalAcceptanceRequired: true,
      }),
    ).toBe("terms");
  });

  it("lets a member who accepted through, to first-run or the tabs", () => {
    const accepted = {
      legalAcceptanceStatus: "success" as const,
      legalAcceptanceRequired: false,
    };
    expect(resolveAuthGate({ ...member, ...incomplete, ...accepted })).toBe(
      "welcome",
    );
    expect(resolveAuthGate({ ...member, ...complete, ...accepted })).toBe(
      "tabs",
    );
  });

  it("leaves a user with no membership on join, which carries its own checkbox", () => {
    expect(
      resolveAuthGate({
        ...member,
        chapterId: null,
        ...emptyMemberships,
        legalAcceptanceStatus: "success",
        legalAcceptanceRequired: true,
      }),
    ).toBe("join");
  });

  it("holds a member only for the read's first answer", () => {
    expect(
      resolveAuthGate({
        ...member,
        ...complete,
        legalAcceptanceStatus: "pending",
      }),
    ).toBe("hold");
  });

  it("fails open to the tabs when the read fails", () => {
    expect(
      resolveAuthGate({
        ...member,
        ...complete,
        legalAcceptanceStatus: "error",
        legalAcceptanceRequired: true,
      }),
    ).toBe("tabs");
  });

  it("never asks when the caller can't see the read (the frozen tabs layout)", () => {
    expect(resolveAuthGate({ ...member, ...complete })).toBe("tabs");
  });
});

describe("legalReadStatus (#2302)", () => {
  it("keeps a cached answer when a background refetch fails", () => {
    // TanStack: status 'error', data kept. Reading the error first would
    // discard `required: true` and walk the member past the prompt.
    expect(
      legalReadStatus({ authenticated: true, hasAnswer: true, isError: true }),
    ).toBe("success");
  });

  it("fails open only when a first read failed", () => {
    expect(
      legalReadStatus({ authenticated: true, hasAnswer: false, isError: true }),
    ).toBe("error");
  });

  it("is pending until the first answer, and idle when signed out", () => {
    expect(
      legalReadStatus({ authenticated: true, hasAnswer: false, isError: false }),
    ).toBe("pending");
    expect(
      legalReadStatus({ authenticated: false, hasAnswer: true, isError: false }),
    ).toBe("idle");
  });
});

describe("the two layouts cannot loop", () => {
  const statuses = ["hydrating", "authenticated", "unauthenticated"] as const;
  const chapterIds = [null, "chapter-a"];
  const resolving = [true, false];
  const membershipCases: Array<
    Pick<AuthGateInput, "membershipsStatus" | "memberships">
  > = [
    NO_MEMBERSHIPS,
    emptyMemberships,
    incomplete,
    complete,
    { membershipsStatus: "pending", memberships: [] },
    { membershipsStatus: "error", memberships: [] },
  ];

  const legalCases: Array<
    Pick<AuthGateInput, "legalAcceptanceStatus" | "legalAcceptanceRequired">
  > = [
    {},
    { legalAcceptanceStatus: "pending" },
    { legalAcceptanceStatus: "error" },
    { legalAcceptanceStatus: "success", legalAcceptanceRequired: true },
    { legalAcceptanceStatus: "success", legalAcceptanceRequired: false },
  ];

  const everyState: AuthGateInput[] = statuses.flatMap((status) =>
    chapterIds.flatMap((chapterId) =>
      resolving.flatMap((isChapterResolving) =>
        membershipCases.flatMap((memberships) =>
          legalCases.map((legal) => ({
            status,
            chapterId,
            isChapterResolving,
            ...memberships,
            ...legal,
          })),
        ),
      ),
    ),
  );

  // How each layout reacts to a destination. `(auth)` redirects out of its
  // group only for `tabs`. `(tabs)` only redirects for `sign-in`.
  // join/terms/welcome stay inside `(auth)`; the tabs group is walked off those destinations by
  // `AppRuntime`, not by a second layout redirect, so the two still cannot
  // bounce each other.
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
      expect(["hold", "sign-in", "join", "terms", "welcome", "tabs"]).toContain(
        resolveAuthGate(state),
      );
    }
  });

  /**
   * The cold-start flash. `chapterId` is null before the claim read finishes as
   * well as after it finds nothing, so a provider that seeded its resolving
   * flag `false` would produce one committed render of the post-read state
   * before the read had happened. That render must not be a redirect *to
   * sign-in*.
   */
  it("never redirects out of the tabs purely for a missing chapter", () => {
    for (const isChapterResolving of resolving) {
      expect(
        resolveAuthGate({
          status: "authenticated",
          chapterId: null,
          isChapterResolving,
          ...NO_MEMBERSHIPS,
        }),
      ).not.toBe("sign-in");
    }
  });
});
