import { describe, expect, it } from "vitest";
import {
  auditChangeSummary,
  pointsChange,
  readAnnouncementBody,
  readEventPayload,
  readHoursPayload,
  readPointsPayload,
  readRushPayload,
  readSystemAuditPayload,
  readTaskPayload,
} from "./cards";
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

/** The shape `PointsService` posts after the ledger write. */
const POINTS = {
  actor_user_id: "user-a",
  actor_name: "Paul Carlson",
  recipient_user_id: "user-b",
  recipient_name: "Elias Brandt",
  amount: 5,
  category: "MANUAL",
  reason: "Ran the philanthropy table",
  transaction_id: "txn-1",
  created_at: "2026-11-01T12:00:00.000Z",
};

/** The shape `ServiceEntryService` posts for `/hours log`. */
const HOURS = {
  entry_id: "entry-1",
  user_id: "user-b",
  user_name: "Elias Brandt",
  duration_minutes: 150,
  description: "Food bank shift",
  date: "2026-11-04",
  status: "PENDING",
  created_at: "2026-11-04T18:00:00.000Z",
};

/** The shape `RushService.postRushCard` posts for `/rush add`. */
const RUSH = {
  candidate_id: "cand-1",
  display_name: "Jordan Reyes",
  added_by_user_id: "user-a",
  added_by_name: "Paul Carlson",
  stage: "new",
  bid_status: "none",
  created_at: "2026-11-04T18:00:00.000Z",
};

/** The shape `ChatBridgeWorkerService` mirrors into `#chapter-audit`. */
const AUDIT = {
  action: "role_updated",
  actor_user_id: "user-a",
  diff: { permissions: { added: ["tasks:manage"], removed: [] } },
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

describe("readPointsPayload", () => {
  it("reads the payload the server posts", () => {
    expect(readPointsPayload(withPayload(POINTS))).toEqual(POINTS);
  });

  it("returns null without either name, the reason or a finite amount", () => {
    for (const key of ["actor_name", "recipient_name", "reason", "amount"]) {
      expect(
        readPointsPayload(withPayload({ ...POINTS, [key]: undefined })),
      ).toBe(null);
    }
    expect(
      readPointsPayload(withPayload({ ...POINTS, amount: Number.POSITIVE_INFINITY })),
    ).toBe(null);
    expect(readPointsPayload(withPayload("5"))).toBe(null);
  });

  it("reads any category but FINE as a grant, and defaults the ids", () => {
    expect(
      readPointsPayload(
        withPayload({
          ...POINTS,
          category: "BONUS",
          actor_user_id: 1,
          recipient_user_id: null,
          transaction_id: undefined,
        }),
      ),
    ).toMatchObject({
      category: "MANUAL",
      actor_user_id: "",
      recipient_user_id: "",
      transaction_id: "",
    });
  });
});

describe("pointsChange", () => {
  const read = (overrides: Record<string, unknown>) =>
    readPointsPayload(withPayload({ ...POINTS, ...overrides }))!;

  it("states a grant", () => {
    expect(pointsChange(read({}))).toEqual({
      fine: false,
      verb: "granted",
      preposition: "to",
      amount: "+5 points",
    });
  });

  it("states a deduction with the typographic minus, by sign or by category", () => {
    const expected = {
      fine: true,
      verb: "deducted",
      preposition: "from",
      amount: "\u22125 points",
    };
    expect(pointsChange(read({ amount: -5, category: "FINE" }))).toEqual(
      expected,
    );
    expect(pointsChange(read({ amount: -5 }))).toEqual(expected);
    expect(pointsChange(read({ amount: 5, category: "FINE" }))).toEqual(
      expected,
    );
  });

  it("says point for one", () => {
    expect(pointsChange(read({ amount: 1 })).amount).toBe("+1 point");
    expect(pointsChange(read({ amount: -1 })).amount).toBe("\u22121 point");
  });
});

describe("readHoursPayload", () => {
  it("reads the payload the server posts", () => {
    expect(readHoursPayload(withPayload(HOURS))).toEqual(HOURS);
  });

  it("returns null without the ids, the name, the description, the date or a finite duration", () => {
    for (const key of [
      "entry_id",
      "user_id",
      "user_name",
      "description",
      "date",
      "duration_minutes",
    ]) {
      expect(readHoursPayload(withPayload({ ...HOURS, [key]: undefined }))).toBe(
        null,
      );
    }
    expect(
      readHoursPayload(withPayload({ ...HOURS, duration_minutes: "150" })),
    ).toBe(null);
  });

  it("always reports the creation-time status, whatever the row says", () => {
    expect(
      readHoursPayload(withPayload({ ...HOURS, status: "APPROVED" }))?.status,
    ).toBe("PENDING");
  });
});

describe("readSystemAuditPayload", () => {
  it("reads the payload the audit mirror posts", () => {
    expect(readSystemAuditPayload(withPayload(AUDIT))).toEqual(AUDIT);
  });

  it("returns null for the server's payload-less notices and a blank action", () => {
    expect(readSystemAuditPayload(withPayload(null))).toBe(null);
    expect(readSystemAuditPayload(withPayload({ ...AUDIT, action: "" }))).toBe(
      null,
    );
    expect(
      readSystemAuditPayload(withPayload({ ...AUDIT, action: "  " })),
    ).toBe(null);
    expect(readSystemAuditPayload(withPayload({ ...AUDIT, action: 3 }))).toBe(
      null,
    );
  });

  it("reads a missing actor as the system and a non-object diff as none", () => {
    expect(
      readSystemAuditPayload(
        withPayload({ action: "chapter_config_updated", diff: ["name"] }),
      ),
    ).toEqual({ action: "chapter_config_updated", actor_user_id: null, diff: {} });
    expect(
      readSystemAuditPayload(withPayload({ ...AUDIT, diff: "name" }))?.diff,
    ).toEqual({});
  });
});

describe("readAnnouncementBody", () => {
  const message = (content: unknown, payload: unknown) =>
    ({ content, payload }) as unknown as ChatMessage;

  it("prefers content, what the push and the preview show", () => {
    expect(readAnnouncementBody(message("Dues are due", { body: "Other" }))).toBe(
      "Dues are due",
    );
  });

  it("falls back to the body when content is blank", () => {
    expect(readAnnouncementBody(message("  ", { body: "Dues are due" }))).toBe(
      "Dues are due",
    );
  });

  it("returns null with neither", () => {
    expect(readAnnouncementBody(message("", { body: "" }))).toBe(null);
    expect(readAnnouncementBody(message("", null))).toBe(null);
  });
});

describe("auditChangeSummary", () => {
  const audit = (diff: Record<string, unknown>) => ({
    action: "role_updated",
    actor_user_id: null,
    diff,
  });

  it("lists the fields the change touched, in the diff's order", () => {
    expect(auditChangeSummary(audit({ permissions: {}, name: {} }))).toBe(
      "Changed: permissions, name",
    );
  });

  it("says when the change touched no field", () => {
    expect(auditChangeSummary(audit({}))).toBe("No field changes recorded");
  });
});

describe("readRushPayload", () => {
  it("reads the payload the server posts", () => {
    expect(readRushPayload(withPayload(RUSH))).toEqual(RUSH);
  });

  it("returns null without the candidate id, the candidate's name or the adder's name", () => {
    for (const key of ["candidate_id", "display_name", "added_by_name"]) {
      expect(readRushPayload(withPayload({ ...RUSH, [key]: undefined }))).toBe(
        null,
      );
    }
    expect(readRushPayload(withPayload({ ...RUSH, candidate_id: "" }))).toBe(
      null,
    );
    expect(readRushPayload(withPayload(null))).toBe(null);
  });

  it("always reports the creation-time bid, whatever the row says", () => {
    expect(
      readRushPayload(withPayload({ ...RUSH, bid_status: "extended" }))
        ?.bid_status,
    ).toBe("none");
  });

  it("defaults the optional fields", () => {
    expect(
      readRushPayload(
        withPayload({
          candidate_id: "cand-1",
          display_name: "Jordan Reyes",
          added_by_name: "Paul Carlson",
        }),
      ),
    ).toEqual({
      ...RUSH,
      added_by_user_id: "",
      created_at: "",
    });
  });
});
