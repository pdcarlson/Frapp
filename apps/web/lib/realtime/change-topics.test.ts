import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHANGE_EVENT,
  CHANGE_TOPIC_BUILDERS,
  changeTopic,
} from "./change-topics";

/**
 * Pins the database → client change-ping contract.
 *
 * The other half lives in
 * `supabase/migrations/20260816140000_realtime_carrier_repair.sql`: three
 * trigger functions build these same topics in SQL, and
 * `realtime_messages_scoped_select` authorises them by prefix. Drift between the
 * halves does not fail loudly — the channel still joins and still reports
 * `SUBSCRIBED`, it simply never receives anything, which is indistinguishable
 * from "nothing has changed yet". That silent-success failure mode is exactly
 * what left every `postgres_changes` subscription dead in production for months
 * before #867 pinned it down, so it gets a test rather than a comment.
 *
 * If this fails, fix the migration to match — do not edit the expectation.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    "../../../../supabase/migrations/20260816140000_realtime_carrier_repair.sql",
  ),
  "utf8",
);

describe("change-ping topic contract", () => {
  test("topic strings are exactly what the client expects", () => {
    expect(changeTopic("notifications", "u1")).toBe("notif:u1");
    expect(changeTopic("events", "c1")).toBe("events:c1");
    expect(changeTopic("event_attendance", "e1")).toBe("attendance:e1");
  });

  test("the event name is `change`", () => {
    expect(CHANGE_EVENT).toBe("change");
  });

  test("every table has exactly one builder and no extras creep in", () => {
    expect(Object.keys(CHANGE_TOPIC_BUILDERS).sort()).toEqual([
      "event_attendance",
      "events",
      "notifications",
    ]);
  });

  describe("the migration builds the same topics", () => {
    // The SQL concatenates a prefix with an id column, e.g.
    //   'notif:' || v_row.user_id::text
    test.each([
      ["notifications", "'notif:' || v_row.user_id::text"],
      ["events", "'events:' || v_row.chapter_id::text"],
      ["event_attendance", "'attendance:' || v_row.event_id::text"],
    ])("%s emits the client's topic prefix", (_table, sqlExpression) => {
      expect(MIGRATION).toContain(sqlExpression);
    });

    test("the RLS policy authorises each prefix", () => {
      expect(MIGRATION).toContain("'^notif:");
      expect(MIGRATION).toContain("'^events:");
      expect(MIGRATION).toContain("'^attendance:");
    });

    test("pings are sent on the `change` event and marked private", () => {
      // `realtime.send(payload, event, topic, private)` — the third positional
      // arg is the topic and the fourth is `private`. A ping sent non-private
      // would bypass `realtime.messages` RLS and reach any subscriber.
      expect(MIGRATION).toContain("'change',");
      expect(MIGRATION.match(/perform realtime\.send\(/g)).toHaveLength(3);
      // One `true` per send, closing each call's `private` argument.
      expect(MIGRATION.match(/^\s+true\s*$/gm)?.length).toBe(3);
    });

    test("the two chat tables are published for postgres_changes", () => {
      // Chat is the opposite case: its subscriber consumes `payload.new`, so it
      // needs real replication plus a row-level policy, not a ping.
      expect(MIGRATION).toContain(
        "alter publication supabase_realtime add table public.chat_messages",
      );
      expect(MIGRATION).toContain(
        "alter publication supabase_realtime add table public.chat_message_actions",
      );
      expect(MIGRATION).toContain("public.can_read_chat_message(id)");
    });
  });
});
