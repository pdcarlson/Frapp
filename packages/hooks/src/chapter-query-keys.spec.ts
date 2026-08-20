import { describe, expect, expectTypeOf, it } from "vitest";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { notificationKeys } from "./use-notifications";
import { taskKeys } from "./use-tasks";

const CHAPTER = "chapter-1";
const OTHER = "chapter-2";
const taskFactory = createChapterQueryKeys("tasks");
const pollFactory = createChapterQueryKeys("polls");

describe("createChapterQueryKeys", () => {
  it("matches the taskKeys model for a real chapter id", () => {
    // Wave 1 will replace `taskKeys` with this factory. Until then the two
    // must agree on the key a mounted query actually occupies, or the
    // migration will silently stop matching cache entries.
    expect(taskFactory.lists(CHAPTER)).toEqual(taskKeys.lists(CHAPTER));
    expect(taskFactory.detail(CHAPTER, "task-1")).toEqual(
      taskKeys.detail(CHAPTER, "task-1"),
    );
    expect(taskFactory.all).toEqual(taskKeys.all);
  });

  it("puts chapterId in a position a missing-tenant key cannot occupy", () => {
    const a = pollFactory.list(CHAPTER, { active: true });
    const b = pollFactory.list(OTHER, { active: true });
    expect(a).not.toEqual(b);
    expect(a[1]).toBe(CHAPTER);
    expect(b[1]).toBe(OTHER);
  });

  it("keeps list and detail prefixes distinguishable", () => {
    // The old `["tasks", undefined]` vs `["tasks", id]` collision: a prefix
    // match on the list also matched every detail. The discriminator is why
    // `taskKeys` exists; the factory keeps it.
    const list = taskFactory.lists(CHAPTER);
    const detail = taskFactory.detail(CHAPTER, CHAPTER);
    expect(list).not.toEqual(detail);
    expect(taskFactory.lists(CHAPTER)[2]).toBe("list");
    expect(taskFactory.detail(CHAPTER, "x")[2]).toBe("detail");
    // `list(id)` always includes the filters slot, even when omitted, so it
    // is not the same tuple as the `lists(id)` invalidation prefix.
    expect(taskFactory.list(CHAPTER)).not.toEqual(taskFactory.lists(CHAPTER));
  });

  it("is stricter than today's notificationKeys.list, which still allows null", () => {
    // Proof the factory is the Wave 0 shell, not a silent rewrite of live
    // keys: `notificationKeys.list` still accepts `string | null`. The
    // factory does not. Wave 1 migrates that call site.
    expectTypeOf(notificationKeys.list).parameter(0).toEqualTypeOf<
      string | null
    >();
    expectTypeOf(taskFactory.lists).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(taskKeys.lists).parameter(0).toEqualTypeOf<string | null>();
  });

  it("rejects a key that omits the chapter id at compile time", () => {
    // @ts-expect-error chapterId is required — a missing tenant scope is a type error
    taskFactory.lists();
    // @ts-expect-error null is not a chapter id
    taskFactory.detail(null, "task-1");
  });
});
