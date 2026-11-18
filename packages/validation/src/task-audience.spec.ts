import { describe, expect, it } from "vitest";
import {
  sameTaskWho,
  TASK_AUDIENCE_COPY,
  everyoneCount,
  isTaskAudience,
  normalizeTaskWho,
  openTaskScopeLabel,
  taskGroupLabel,
  taskWhoOf,
  taskWhoRequest,
  taskWhoSuggestionFields,
  type TaskWho,
} from "./task-audience";

describe("task audience (#4295 step 3)", () => {
  it("knows everyone and nothing else", () => {
    expect(isTaskAudience("everyone")).toBe(true);
    expect(isTaskAudience("actives")).toBe(false);
    expect(isTaskAudience(null)).toBe(false);
  });

  it("reads the same people in any order as the same answer", () => {
    expect(
      sameTaskWho(
        { kind: "each", target: { kind: "people", userIds: ["a", "b"] } },
        { kind: "each", target: { kind: "people", userIds: ["b", "a"] } },
      ),
    ).toBe(true);
    expect(
      sameTaskWho(
        { kind: "each", target: { kind: "people", userIds: ["a", "b"] } },
        { kind: "someone", target: { kind: "people", userIds: ["a", "b"] } },
      ),
    ).toBe(false);
    expect(sameTaskWho(null, null)).toBe(true);
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

describe("who a task is for (2026-11-18)", () => {
  const ROLE = { kind: "role", id: "r-1" } as const;
  const GROUP = { kind: "group", id: "g-1" } as const;

  it("sends one person, a copy each and a task up for grabs to the right create", () => {
    const cases: [TaskWho, ReturnType<typeof taskWhoRequest>][] = [
      [
        { kind: "person", userId: "u-1" },
        { endpoint: "/v1/tasks", fields: { assignee_id: "u-1" } },
      ],
      [
        { kind: "each", target: { kind: "chapter" } },
        { endpoint: "/v1/tasks", fields: { audience: "everyone" } },
      ],
      [
        { kind: "each", target: ROLE },
        {
          endpoint: "/v1/tasks",
          fields: { audience: "everyone", audience_role_id: "r-1" },
        },
      ],
      [
        { kind: "each", target: GROUP },
        {
          endpoint: "/v1/tasks",
          fields: { audience: "everyone", audience_group_id: "g-1" },
        },
      ],
      [
        { kind: "each", target: { kind: "people", userIds: ["a", "b", "a"] } },
        { endpoint: "/v1/tasks", fields: { assignee_ids: ["a", "b"] } },
      ],
      [
        { kind: "someone", target: { kind: "chapter" } },
        { endpoint: "/v1/open-tasks", fields: {} },
      ],
      [
        { kind: "someone", target: ROLE },
        { endpoint: "/v1/open-tasks", fields: { role_id: "r-1" } },
      ],
      [
        { kind: "someone", target: GROUP },
        { endpoint: "/v1/open-tasks", fields: { group_id: "g-1" } },
      ],
      [
        { kind: "someone", target: { kind: "people", userIds: ["a", "b"] } },
        { endpoint: "/v1/open-tasks", fields: { user_ids: ["a", "b"] } },
      ],
    ];
    for (const [who, request] of cases) {
      expect(taskWhoRequest(who)).toEqual(request);
    }
  });

  it("reads one picked person as that person, and nobody as nothing to send", () => {
    expect(
      taskWhoRequest({
        kind: "someone",
        target: { kind: "people", userIds: [" a ", "a"] },
      }),
    ).toEqual({ endpoint: "/v1/tasks", fields: { assignee_id: "a" } });
    expect(
      normalizeTaskWho({
        kind: "each",
        target: { kind: "people", userIds: [] },
      }),
    ).toBeNull();
    expect(taskWhoRequest({ kind: "person", userId: " " })).toBeNull();
  });

  it("writes a suggestion's fields with every key, so an edit replaces the answer", () => {
    expect(taskWhoSuggestionFields({ kind: "person", userId: "u-1" })).toEqual({
      assignee_id: "u-1",
      assignee_ids: null,
      audience: null,
      audience_role_id: null,
      audience_group_id: null,
    });
    expect(
      taskWhoSuggestionFields({
        kind: "each",
        target: { kind: "people", userIds: ["a", "b"] },
      }),
    ).toMatchObject({ assignee_ids: ["a", "b"], audience: null });
    expect(
      taskWhoSuggestionFields({ kind: "each", target: ROLE }),
    ).toMatchObject({ audience: "everyone", audience_role_id: "r-1" });
    expect(
      taskWhoSuggestionFields({ kind: "someone", target: GROUP }),
    ).toMatchObject({ audience: "someone", audience_group_id: "g-1" });
    expect(
      taskWhoSuggestionFields({
        kind: "someone",
        target: { kind: "people", userIds: ["a", "b"] },
      }),
    ).toMatchObject({ audience: "someone", assignee_ids: ["a", "b"] });
    expect(taskWhoSuggestionFields(null).assignee_id).toBeNull();
  });

  it("reads each source back into the picker's answer", () => {
    const whos: TaskWho[] = [
      { kind: "person", userId: "u-1" },
      { kind: "each", target: { kind: "chapter" } },
      { kind: "each", target: ROLE },
      { kind: "each", target: GROUP },
      { kind: "each", target: { kind: "people", userIds: ["a", "b"] } },
      { kind: "someone", target: { kind: "chapter" } },
      { kind: "someone", target: ROLE },
      { kind: "someone", target: GROUP },
      { kind: "someone", target: { kind: "people", userIds: ["a", "b"] } },
    ];
    // A suggestion round-trips through its own fields.
    for (const who of whos) {
      expect(taskWhoOf(taskWhoSuggestionFields(who))).toEqual(who);
    }
    // The fields a shipped build writes still read.
    expect(taskWhoOf({ assignee_id: "u-1", audience: null })).toEqual(whos[0]);
    expect(taskWhoOf({ assignee_id: null, audience: "everyone" })).toEqual(
      whos[1],
    );
    expect(taskWhoOf({ assignee_id: null })).toBeNull();

    expect(taskWhoOf({ scope: "chapter" })).toEqual(whos[5]);
    expect(taskWhoOf({ scope: "role", scope_id: "r-1" })).toEqual(whos[6]);
    expect(taskWhoOf({ scope: "group", scope_id: "g-1" })).toEqual(whos[7]);
    expect(taskWhoOf({ scope: "people", scope_user_ids: ["a", "b"] })).toEqual(
      whos[8],
    );

    expect(taskWhoOf({ assignee_id: "u-1", group: null })).toEqual(whos[0]);
    expect(
      taskWhoOf({ assignee_id: "u-1", group: { audience: "everyone" } }),
    ).toEqual(whos[1]);
    expect(
      taskWhoOf({
        assignee_id: "u-1",
        group: { audience: "role", target_id: "r-1" },
      }),
    ).toEqual(whos[2]);
    expect(
      taskWhoOf(
        { assignee_id: "a", group: { audience: "people" } },
        { groupUserIds: ["a", "b"] },
      ),
    ).toEqual(whos[4]);
    expect(
      taskWhoOf({ assignee_id: "a", group: { audience: "people" } }),
    ).toEqual({ kind: "each", target: { kind: "people", userIds: [] } });
  });

  it("words who a group task and a task up for grabs are for", () => {
    expect(taskGroupLabel({ audience: "everyone", total: 20 })).toBe(
      "Everyone",
    );
    expect(
      taskGroupLabel({
        audience: "role",
        target_name: "Recruitment Committee",
        total: 6,
      }),
    ).toBe("Everyone in Recruitment Committee");
    expect(taskGroupLabel({ audience: "people", total: 6 })).toBe("6 people");
    expect(openTaskScopeLabel({ scope: "chapter" })).toBe(
      "Anyone in the chapter",
    );
    expect(
      openTaskScopeLabel({ scope: "role", scope_name: "Philanthropy Chair" }),
    ).toBe("Someone in Philanthropy Chair");
    expect(
      openTaskScopeLabel({ scope: "people", scope_user_ids: ["a", "b", "c"] }),
    ).toBe("One of 3 people");
    expect(
      openTaskScopeLabel({ scope: "people" }, [
        "Sam",
        "Alex",
        "Jo",
        "Kim",
        "Lee",
      ]),
    ).toBe("One of Sam, Alex and 3 others");
  });

  it("words the names, the hints and the counts", () => {
    expect(TASK_AUDIENCE_COPY.peopleNames(["Sam"])).toBe("Sam");
    expect(TASK_AUDIENCE_COPY.peopleNames(["Sam", "Alex"])).toBe(
      "Sam and Alex",
    );
    expect(TASK_AUDIENCE_COPY.peopleNames(["Sam", "Alex", "Jo"])).toBe(
      "Sam, Alex and Jo",
    );
    expect(TASK_AUDIENCE_COPY.eachHint(6)).toBe(
      "Each of 6 members gets their own copy.",
    );
    expect(TASK_AUDIENCE_COPY.someoneHint(6)).toBe(
      "One of 6 members takes it. It goes on Up for grabs.",
    );
    expect(TASK_AUDIENCE_COPY.people(1)).toBe("1 person");
  });
});
