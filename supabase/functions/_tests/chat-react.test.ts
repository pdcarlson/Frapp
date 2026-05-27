// Tests for the `chat-react` Edge Function entrypoint
// (`supabase/functions/chat-react/index.ts`).
//
// Pins the same authz-wiring + change-detector pattern as chat-send.test.ts,
// plus the §4 atomic-dedup branch: a Postgres `23505` (unique violation) from
// the insert must surface as a successful dedup (200 + { deduplicated: true }),
// not a 5xx, and must NOT retry the insert (i.e. not a read-then-insert TOCTOU).

import { assertEquals } from "@std/assert";
import {
  buildMockClient,
  buildRequest,
  getCapturedHandler,
  installDenoServeInterceptor,
  setEnv,
  withBearer,
} from "./test-helpers.ts";
import { setNextClient } from "./supabase-stub.ts";

setEnv();
installDenoServeInterceptor();
await import("../chat-react/index.ts");
const handler = getCapturedHandler();

const VALID_BODY = {
  message_id: "44444444-4444-4444-4444-444444444444",
  action_type: "reaction:smile",
};

const AUTH_USER = { id: "auth-uid-1" };
const APP_USER_ROW = { data: { id: "app-user-1" }, error: null };
const MESSAGE_ROW = {
  data: { channel_id: "55555555-5555-5555-5555-555555555555" },
  error: null,
};
const PUBLIC_CHANNEL = {
  data: {
    id: "55555555-5555-5555-5555-555555555555",
    chapter_id: "chapter-1",
    type: "PUBLIC",
    member_ids: null,
    required_permissions: null,
  },
  error: null,
};
const MEMBER_ROW = { data: { role_ids: [] }, error: null };

// ── Auth / identity ────────────────────────────────────────────────────────

Deno.test("chat-react: missing Authorization header → 401", async () => {
  setNextClient(buildMockClient().client);
  const res = await handler(
    buildRequest({ method: "POST", body: VALID_BODY }),
  );
  assertEquals(res.status, 401);
});

Deno.test("chat-react: invalid JWT → 401 (and no insert)", async () => {
  const mock = buildMockClient({
    authGetUser: { data: { user: null }, error: { message: "bad jwt" } },
  });
  setNextClient(mock.client);
  const res = await handler(
    buildRequest({
      method: "POST",
      headers: withBearer("bogus-jwt"),
      body: VALID_BODY,
    }),
  );
  assertEquals(res.status, 401);
  assertEquals(mock.insertCalls("chat_message_actions").length, 0);
});

// ── Authz wiring ───────────────────────────────────────────────────────────

Deno.test("chat-react: message-not-accessible → 403 and the action insert never runs", async () => {
  const mock = buildMockClient({
    authGetUser: { data: { user: AUTH_USER }, error: null },
    tables: {
      users: [APP_USER_ROW],
      // Message resolves OK, channel resolves OK, but the caller is NOT a
      // chapter member → assertChannelAccess returns 403.
      chat_messages: [MESSAGE_ROW],
      chat_channels: [PUBLIC_CHANNEL],
      members: [{ data: null, error: null }],
    },
  });
  setNextClient(mock.client);
  const res = await handler(
    buildRequest({
      method: "POST",
      headers: withBearer("good-jwt"),
      body: VALID_BODY,
    }),
  );
  assertEquals(res.status, 403);
  // The change-detector: the service-role insert never ran on an authz fail.
  assertEquals(mock.insertCalls("chat_message_actions").length, 0);
});

// ── Happy path ─────────────────────────────────────────────────────────────

Deno.test("chat-react: happy path returns 201 with { action, deduplicated: false }", async () => {
  const actionRow = {
    id: "action-1",
    message_id: VALID_BODY.message_id,
    user_id: "app-user-1",
    action_type: VALID_BODY.action_type,
  };
  const mock = buildMockClient({
    authGetUser: { data: { user: AUTH_USER }, error: null },
    tables: {
      users: [APP_USER_ROW],
      chat_messages: [MESSAGE_ROW],
      chat_channels: [PUBLIC_CHANNEL],
      members: [MEMBER_ROW],
      chat_message_actions: [{ data: actionRow, error: null }],
    },
  });
  setNextClient(mock.client);
  const res = await handler(
    buildRequest({
      method: "POST",
      headers: withBearer("good-jwt"),
      body: VALID_BODY,
    }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.action, actionRow);
  assertEquals(body.deduplicated, false);
  // user_id sourced from the trusted users lookup, not the body.
  const [insertPayload] = mock.insertCalls("chat_message_actions") as Array<
    Record<string, unknown>
  >;
  assertEquals(insertPayload.user_id, "app-user-1");
});

// ── 23505 atomic-dedup race (the §4 change-detector) ───────────────────────

Deno.test(
  "chat-react: insert returns Postgres 23505 → 200 { action, deduplicated: true } and no second insert",
  async () => {
    const existingRow = {
      id: "action-existing",
      message_id: VALID_BODY.message_id,
      user_id: "app-user-1",
      action_type: VALID_BODY.action_type,
    };
    const mock = buildMockClient({
      authGetUser: { data: { user: AUTH_USER }, error: null },
      tables: {
        users: [APP_USER_ROW],
        chat_messages: [MESSAGE_ROW],
        chat_channels: [PUBLIC_CHANNEL],
        members: [MEMBER_ROW],
        // Two-step script for chat_message_actions:
        //   1) the insert loses the race → 23505 PostgresError
        //   2) the re-select returns the existing row
        chat_message_actions: [
          {
            data: null,
            error: {
              code: "23505",
              message: "duplicate key value violates unique constraint",
              details: "(message_id, user_id, action_type) already exists",
            },
          },
          { data: existingRow, error: null },
        ],
      },
    });
    setNextClient(mock.client);
    const res = await handler(
      buildRequest({
        method: "POST",
        headers: withBearer("good-jwt"),
        body: VALID_BODY,
      }),
    );
    // Dedup is a SUCCESS path, not a 5xx.
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.action, existingRow);
    assertEquals(body.deduplicated, true);

    // The insert was attempted EXACTLY ONCE — the dedup path is the
    // re-select, not a retried insert (proves the unique-violation branch is
    // not a read-then-insert TOCTOU).
    assertEquals(mock.insertCalls("chat_message_actions").length, 1);
    // And the second `chat_message_actions` call was a select, not an insert.
    const actionCalls = mock.calls.builder.filter(
      (c) => c.table === "chat_message_actions",
    );
    const insertIdx = actionCalls.findIndex((c) => c.method === "insert");
    const selectIdx = actionCalls.findIndex(
      (c, i) => i > insertIdx && c.method === "select",
    );
    assertEquals(insertIdx !== -1 && selectIdx > insertIdx, true);
  },
);

Deno.test(
  "chat-react: non-23505 insert error → 500 (no false-positive dedup)",
  async () => {
    const mock = buildMockClient({
      authGetUser: { data: { user: AUTH_USER }, error: null },
      tables: {
        users: [APP_USER_ROW],
        chat_messages: [MESSAGE_ROW],
        chat_channels: [PUBLIC_CHANNEL],
        members: [MEMBER_ROW],
        chat_message_actions: [
          {
            data: null,
            error: { code: "23502", message: "not null violation" },
          },
        ],
      },
    });
    setNextClient(mock.client);
    const res = await handler(
      buildRequest({
        method: "POST",
        headers: withBearer("good-jwt"),
        body: VALID_BODY,
      }),
    );
    assertEquals(res.status, 500);
  },
);
