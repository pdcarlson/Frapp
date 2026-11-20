import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

/** The web half of the phone's s03 gate (#5627). */
const mocks = vi.hoisted(() => ({
  pathname: "/chat",
  replace: vi.fn(),
  chapters: [] as unknown[],
  required: false as boolean | undefined,
  activeChapterId: "ch-1" as string | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@repo/hooks", () => ({
  useAccessibleChapters: () => ({ data: mocks.chapters }),
  useLegalAcceptance: () => ({
    data:
      mocks.required === undefined ? undefined : { required: mocks.required },
  }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    select: (s: { activeChapterId: string | null }) => unknown,
  ) => select({ activeChapterId: mocks.activeChapterId }),
}));

import { WelcomeGate, isWelcomeQuietPath } from "./welcome-gate";

const joined = (done: boolean) => [
  { chapter_id: "ch-1", has_completed_onboarding: done },
  { chapter_id: "ch-2", has_completed_onboarding: true },
];

describe("WelcomeGate", () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    mocks.pathname = "/chat";
    mocks.chapters = joined(false);
    mocks.required = false;
    mocks.activeChapterId = "ch-1";
  });

  it("sends a member who hasn't finished joining back to their name", () => {
    render(<WelcomeGate />);
    expect(mocks.replace).toHaveBeenCalledWith("/welcome");
  });

  it("leaves a finished member, another chapter's finish, and a founder alone", () => {
    mocks.chapters = joined(true);
    render(<WelcomeGate />);
    mocks.activeChapterId = "ch-2";
    mocks.chapters = joined(false);
    render(<WelcomeGate />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("waits for the Terms prompt and stays off Chapter settings", () => {
    mocks.required = true;
    render(<WelcomeGate />);
    mocks.required = undefined;
    render(<WelcomeGate />);
    mocks.required = false;
    mocks.pathname = "/settings";
    render(<WelcomeGate />);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("knows its quiet routes", () => {
    expect(isWelcomeQuietPath("/billing")).toBe(true);
    expect(isWelcomeQuietPath("/settings/roles")).toBe(true);
    expect(isWelcomeQuietPath("/settingsx")).toBe(false);
    expect(isWelcomeQuietPath(null)).toBe(false);
  });
});
