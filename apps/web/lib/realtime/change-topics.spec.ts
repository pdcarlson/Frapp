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

/**
 * The migration with `--` comments stripped.
 *
 * That file is deliberately comment-heavy, and its prose quotes the very SQL
 * these assertions match — the block explaining why each send needs an
 * exception handler names `perform realtime.send(...)` in passing. Counting
 * against the raw text therefore found four sends where three exist. Assertions
 * about what the migration *does* must read executable SQL only.
 */
const MIGRATION_SQL = MIGRATION.replace(/--[^\n]*/g, "");

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
    // The triggers are STATEMENT-level over a transition table: each loops
    // `select distinct <scope column> from changed` and concatenates the prefix
    // onto that scope. Both halves are asserted — the prefix alone would not
    // catch a trigger reading the wrong column, which is the mistake that
    // silently sends every ping to the wrong topic.
    test.each([
      ["notifications", "select distinct user_id from changed", "'notif:' || v_scope::text"],
      ["events", "select distinct chapter_id from changed", "'events:' || v_scope::text"],
      ["event_attendance", "select distinct event_id from changed", "'attendance:' || v_scope::text"],
    ])("%s scopes by the right column and emits the client's topic prefix", (_table, scopeSelect, topicExpr) => {
      expect(MIGRATION_SQL).toContain(scopeSelect);
      expect(MIGRATION_SQL).toContain(topicExpr);
    });

    test("the ping triggers are statement-level, not per-row", () => {
      // Per-row turns one bulk write (markAutoAbsent inserts a row per member)
      // into N subtransactions, N broadcast frames on one topic, and 2N
      // client invalidations that each cancel the in-flight refetch. Statement
      // level with `select distinct` collapses it to one ping per scope.
      expect(MIGRATION_SQL).not.toMatch(/for each row execute function public\.realtime_notify/);
      expect(
        MIGRATION_SQL.match(/for each statement execute function public\.realtime_notify/g),
      ).toHaveLength(9); // 3 tables x insert/update/delete
    });

    test("the RLS policy authorises each prefix", () => {
      expect(MIGRATION_SQL).toContain("'^notif:");
      expect(MIGRATION_SQL).toContain("'^events:");
      expect(MIGRATION_SQL).toContain("'^attendance:");
    });

    test("pings are sent on the `change` event and marked private", () => {
      // `realtime.send(payload, event, topic, private)` — the fourth positional
      // arg is `private`. A ping sent non-private would bypass
      // `realtime.messages` RLS entirely and reach any client that guessed the
      // topic string, so this is the security-critical argument in the file.
      //
      // Matched POSITIONALLY, inside each call's own parens. An earlier version
      // counted file-global `/^\s+true\s*$/` lines, which was wrong twice over:
      // it collapsed to 0 on a purely cosmetic reflow, and a `true` → `false`
      // flip could pass simply by adding an unrelated line-final `true`
      // elsewhere in a 350-line file that already has four `do $$` blocks.
      const sends = MIGRATION_SQL.match(
        /perform realtime\.send\((?:[^()]|\([^()]*\))*\)/g,
      );
      expect(sends).toHaveLength(3);
      for (const send of sends ?? []) {
        expect(send).toMatch(/,\s*'change'\s*,/);
        expect(send).toMatch(/,\s*true\s*\)$/);
      }
    });

    test("the two chat tables are published for postgres_changes", () => {
      // Chat is the opposite case: its subscriber consumes `payload.new`, so it
      // needs real replication plus a row-level policy, not a ping.
      expect(MIGRATION_SQL).toContain(
        "alter publication supabase_realtime add table public.chat_messages",
      );
      expect(MIGRATION_SQL).toContain(
        "alter publication supabase_realtime add table public.chat_message_actions",
      );
      expect(MIGRATION_SQL).toContain("public.can_read_chat_message(id)");
    });

    test("chapter_audit_log is published for the server-side worker", () => {
      // The sixth dead subscription, and the only one outside the browser:
      // `ChatBridgeWorkerService` subscribes to INSERTs on this table to mirror
      // audit rows into #chapter-audit. It uses the service-role client, which
      // bypasses RLS, so publication membership is the entire fix — and its
      // absence is why that channel has always been empty.
      expect(MIGRATION_SQL).toContain(
        "alter publication supabase_realtime add table public.chapter_audit_log",
      );
    });
  });
});
