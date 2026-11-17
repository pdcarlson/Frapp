import { describe, expect, it } from "vitest";
import {
  TASK_AUDIENCE_COPY,
  everyoneCount,
  isTaskAudience,
  taskWhoFields,
  taskWhoValue,
} from "./task-audience";

describe("task audience (#4295 step 3)", () => {
  it("knows everyone and nothing else", () => {
    expect(isTaskAudience("everyone")).toBe(true);
    expect(isTaskAudience("actives")).toBe(false);
    expect(isTaskAudience(null)).toBe(false);
  });

  it("reads a picker's value from a person or a group, the group first", () => {
    expect(taskWhoValue({ assignee_id: "u-1" })).toBe("u-1");
    expect(taskWhoValue({ assignee_id: null, audience: "everyone" })).toBe(
      "everyone",
    );
    expect(taskWhoValue({ assignee_id: null, audience: null })).toBe("");
  });

  it("writes a picker's value back as the field it is", () => {
    expect(taskWhoFields("u-1")).toEqual({ assignee_id: "u-1" });
    expect(taskWhoFields("everyone")).toEqual({ audience: "everyone" });
  });

  it("words the progress and the hint", () => {
    expect(TASK_AUDIENCE_COPY.progress(14, 20)).toBe("14 of 20 done");
    expect(TASK_AUDIENCE_COPY.everyoneHint(20)).toBe(
      "Each of 20 active members gets their own copy.",
    );
    expect(TASK_AUDIENCE_COPY.everyoneHint(null)).toBe(
      "Each active member gets their own copy.",
    );
  });

  it("counts everyone as the API does: alumni and empty rows left out", () => {
    expect(
      everyoneCount([
        { user_id: "a" },
        { user_id: "b", is_alumni: true },
        { user_id: null },
        { user_id: "a" },
        { user_id: "c", is_alumni: false },
      ]),
    ).toBe(2);
  });
});
