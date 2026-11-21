import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChapterMajors } from "./use-groups";
import { createHookWrapper, createTestQueryClient } from "./test-utils";

const group = (
  id: string,
  name: string,
  kind: string,
  member_ids: string[],
) => ({ id, name, kind, member_ids });

describe("useChapterMajors (#5778)", () => {
  it("offers the majors someone has, and no other kind of group", async () => {
    const GET = vi.fn().mockResolvedValue({
      data: [
        group("g-1", "Third floor", "manual", ["u1"]),
        group("g-2", "Alpha", "pledge_class", ["u1"]),
        group("g-3", "Class of 2027", "class_year", ["u1"]),
        group("g-4", "Mechanical Engineering", "major", ["u1", "u2"]),
        group("g-5", "Industrial Systems", "major", []),
        group("g-6", "Music", "major", ["u3"]),
      ],
      error: null,
    });
    const { result } = renderHook(() => useChapterMajors(), {
      wrapper: createHookWrapper({
        queryClient: createTestQueryClient(),
        client: { GET },
        chapterId: "chapter-abc",
      }),
    });

    await waitFor(() =>
      expect(result.current).toEqual(["Mechanical Engineering", "Music"]),
    );
    expect(GET).toHaveBeenCalledWith("/v1/groups", expect.anything());
  });

  it("reads nothing while disabled", () => {
    const GET = vi.fn();
    const { result } = renderHook(() => useChapterMajors({ enabled: false }), {
      wrapper: createHookWrapper({
        queryClient: createTestQueryClient(),
        client: { GET },
        chapterId: "chapter-abc",
      }),
    });
    expect(result.current).toEqual([]);
    expect(GET).not.toHaveBeenCalled();
  });
});
