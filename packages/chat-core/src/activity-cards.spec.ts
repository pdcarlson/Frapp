import { describe, expect, it } from "vitest";
import {
  activityEventMessage,
  activityHoursMessage,
  activityPollMessage,
  activityTaskMessage,
} from "./activity-cards";
import { readEventPayload, readHoursPayload, readTaskPayload } from "./cards";
import { readPollPayload, tallyPollVotes } from "./polls";

/*
 * The contract these builders owe: the message they build is one chat's own
 * card reader accepts, carrying the record's id, so the card draws and its
 * buttons act on the right record.
 */
describe("Activity card messages", () => {
  it("builds a task message the task card reads", () => {
    const message = activityTaskMessage({
      id: "task-1",
      title: "Book the venue",
      due_date: "2026-11-20",
      assignee_id: "user-a",
      assignee_name: "Ada",
      created_by: "user-b",
      created_by_name: "Ben",
      point_reward: 5,
      created_at: "2026-11-01T00:00:00.000Z",
    });

    expect(message.kind).toBe("task");
    expect(readTaskPayload(message)).toMatchObject({
      task_id: "task-1",
      title: "Book the venue",
      assigner_user_id: "user-b",
      assigner_name: "Ben",
      assignee_user_id: "user-a",
      assignee_name: "Ada",
      due_date: "2026-11-20",
      point_reward: 5,
    });
  });

  it("builds an event message the event card reads, with the member's own answer", () => {
    const row = {
      id: "event-1",
      name: "Chapter meeting",
      location: null,
      start_time: "2026-11-12T19:00:00.000Z",
      end_time: "2026-11-12T20:00:00.000Z",
      point_value: 10,
      check_in_opens_minutes: 10,
    };

    expect(
      readEventPayload(
        activityEventMessage({ ...row, attendance: "required" }),
      ),
    ).toMatchObject({
      event_id: "event-1",
      name: "Chapter meeting",
      start_time: row.start_time,
      end_time: row.end_time,
      // What the card needs to offer Check in and to say what it is worth.
      location: null,
      point_value: 10,
      check_in_opens_minutes: 10,
      is_mandatory: true,
    });
    expect(
      readEventPayload(activityEventMessage({ ...row, attendance: "optional" }))
        ?.is_mandatory,
    ).toBe(false);
  });

  it("builds an hours message the hours card reads", () => {
    const message = activityHoursMessage({
      id: "entry-1",
      user_id: "user-a",
      member_name: "Ada",
      date: "2026-11-08",
      duration_minutes: 90,
      description: "Food bank",
      created_at: "2026-11-08T12:00:00.000Z",
    });

    expect(readHoursPayload(message)).toMatchObject({
      entry_id: "entry-1",
      user_id: "user-a",
      user_name: "Ada",
      duration_minutes: 90,
    });
  });

  it("never builds an id that could be sent to a message route", () => {
    // A built message stands for a record, not a chat message: its id is
    // namespaced and it has no channel.
    const message = activityHoursMessage({
      id: "entry-1",
      user_id: "user-a",
      member_name: "Ada",
      date: "2026-11-08",
      duration_minutes: 90,
      description: "Food bank",
      created_at: "2026-11-08T12:00:00.000Z",
    });
    expect(message.id).toBe("activity:hours:entry-1");
    expect(message.channel_id).toBe("");
  });

  it("attaches only the poll's own votes to its message, so the card tallies them", () => {
    const raw = {
      id: "poll-1",
      channel_id: "channel-1",
      sender_id: "user-b",
      kind: "poll",
      payload: {
        question: "Formal venue?",
        options: [
          { id: "a", label: "Downtown" },
          { id: "b", label: "Campus" },
        ],
        closes_at: "2026-11-20T00:00:00.000Z",
      },
      created_at: "2026-11-10T00:00:00.000Z",
      sender_blocked: false,
    };
    const vote = (
      id: string,
      messageId: string,
      userId: string,
      option: string,
    ) => ({
      id,
      message_id: messageId,
      user_id: userId,
      action_type: "vote",
      payload: { option_id: option },
      created_at: "2026-11-10T01:00:00.000Z",
    });

    const message = activityPollMessage(raw, [
      vote("v1", "poll-1", "user-a", "a"),
      vote("v2", "poll-1", "user-c", "b"),
      vote("v3", "another-poll", "user-a", "b"),
    ]);

    const payload = readPollPayload(message);
    expect(payload?.question).toBe("Formal venue?");
    expect(tallyPollVotes(message, payload!.options, "user-a")).toEqual({
      byOption: { a: 1, b: 1 },
      total: 2,
      voters: 2,
      myVotes: ["a"],
      myVote: "a",
    });
    expect(message.id).toBe("poll-1");
  });
});
