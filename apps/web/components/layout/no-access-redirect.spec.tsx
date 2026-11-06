import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const { state } = vi.hoisted(() => ({
  state: {
    permissions: { data: undefined as { permissions: string[] } | undefined },
    chapters: { data: [] as unknown[], isSuccess: true },
  },
}));
vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => state.permissions,
  useAccessibleChapters: () => state.chapters,
}));

import { NoAccessRedirect } from "./no-access-redirect";

const ONE_CHAPTER = [{ chapter_id: "c1" }];

beforeEach(() => {
  replace.mockClear();
  state.permissions = { data: undefined };
  state.chapters = { data: ONE_CHAPTER, isSuccess: true };
});

describe("NoAccessRedirect (#3236)", () => {
  it("sends a one-chapter member whose roles grant nothing to /no-access", () => {
    state.permissions = { data: { permissions: [] } };
    render(<NoAccessRedirect />);
    expect(replace).toHaveBeenCalledWith("/no-access");
  });

  it("leaves a member who holds any permission where they are", () => {
    state.permissions = { data: { permissions: ["members:view"] } };
    render(<NoAccessRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  // A read that is loading, disabled, or failed with nothing cached has no
  // data, and none of those is an answer of "no permissions".
  it("does not fire before the permission read has answered", () => {
    state.permissions = { data: undefined };
    render(<NoAccessRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not strand a member who belongs to another chapter", () => {
    state.permissions = { data: { permissions: [] } };
    state.chapters = { data: [...ONE_CHAPTER, { chapter_id: "c2" }], isSuccess: true };
    render(<NoAccessRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits for the chapter list too", () => {
    state.permissions = { data: { permissions: [] } };
    state.chapters = { data: [], isSuccess: false };
    render(<NoAccessRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });
});
