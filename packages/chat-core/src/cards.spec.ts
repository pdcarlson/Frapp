import { describe, expect, it } from "vitest";
import { readEventPayload, readTaskPayload } from "./cards";
import type { ChatMessage } from "./types";

/** Only `payload` is read; the rest of the row is irrelevant to the readers. */
function withPayload(payload: unknown): ChatMessage {
  return { payload } as unknown as ChatMessage;
}

/** The shape `EventAnnouncementService` posts. */
const EVENT = {
  event_id: "evt-1",
  name: "Chapter meeting",
  start_time: "2026-11-05T23:00:00.000Z",
  end_time: "2026-11-06T00:00:00.000Z",
  location: "Great Hall",
  point_value: 10,
  is_mandatory: true,
  created_at: "2026-11-01T12:00:00.000Z",
};

/** The shape `TaskService.postTaskCard` posts. */
const TASK = {
  task_id: "task-1",
  title: "Fix the laundry room door",
  assigner_user_id: "user-a",
  assigner_name: "Paul Carlson",
  assignee_user_id: "user-b",
  assignee_name: "Elias Brandt",
  due_date: "2026-11-07",
  status: "TODO",
  point_reward: 15,
  created_at: "2026-11-01T12:00:00.000Z",
};

describe("readEventPayload", () => {
  it("reads the payload the server posts", () => {
    expect(readEventPayload(withPayload(EVENT))).toEqual(EVENT);
  });

  it("returns null without an id, a name or either time", () => {
    for (const key of ["event_id", "name", "start_time", "end_time"]) {
      expect(readEventPayload(withPayload({ ...EVENT, [key]: undefined }))).toBe(
        null,
      );
    }
    expect(readEventPayload(withPayload(null))).toBe(null);
    expect(readEventPayload(withPayload("event"))).toBe(null);
  });

  it("gives the optional fields the defaults the card draws", () => {
    expect(
      readEventPayload(
        withPayload({
          ...EVENT,
          location: 42,
          point_value: Number.NaN,
          is_mandatory: "yes",
          created_at: undefined,
        }),
      ),
    ).toEqual({
      ...EVENT,
      location: null,
      point_value: 0,
      is_mandatory: false,
      created_at: "",
    });
  });
});

describe("readTaskPayload", () => {
  it("reads the payload the server posts", () => {
    expect(readTaskPayload(withPayload(TASK))).toEqual(TASK);
  });

  it("returns null without an id, a title, either name or the due date", () => {
    for (const key of [
      "task_id",
      "title",
      "assignee_name",
      "assigner_name",
      "due_date",
    ]) {
      expect(readTaskPayload(withPayload({ ...TASK, [key]: undefined }))).toBe(
        null,
      );
    }
    expect(readTaskPayload(withPayload(undefined))).toBe(null);
  });

  it("always reports the creation-time status, whatever the row says", () => {
    expect(
      readTaskPayload(withPayload({ ...TASK, status: "COMPLETED" }))?.status,
    ).toBe("TODO");
  });

  it("defaults missing ids to empty and a non-number reward to null", () => {
    expect(
      readTaskPayload(
        withPayload({
          ...TASK,
          assigner_user_id: null,
          assignee_user_id: 7,
          point_reward: "15",
        }),
      ),
    ).toMatchObject({
      assigner_user_id: "",
      assignee_user_id: "",
      point_reward: null,
    });
  });
});
