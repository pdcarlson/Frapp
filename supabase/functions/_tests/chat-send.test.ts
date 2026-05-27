// Tests for the `chat-send` Edge Function entrypoint
// (`supabase/functions/chat-send/index.ts`).
//
// The production code calls `Deno.serve(handler)` at module top level — we
// intercept that and call the captured handler directly with a synthetic
// `Request`. The Supabase client is swapped via the test import map at
// `supabase/functions/_tests/deno.json`. Each test scripts the per-table
// response queue and then asserts both the response shape AND that the
// service-role insert was reached only after authz passed.

import {
  deepStrictEqual as assertEquals,
  notDeepStrictEqual as assertNotEquals,
} from "node:assert/strict";
import {
  buildMockClient,
  buildRequest,
  setEnv,
  withBearer,
} from "./test-helpers.ts";
import { setNextClient } from "./supabase-stub.ts";
import { handler } from "../chat-send/index.ts";

setEnv();

const VALID_BODY = {
  client_message_id: "11111111-1111-1111-1111-111111111111",
  channel_id: "22222222-2222-2222-2222-222222222222",
  content: "hello world",
  kind: "text",
};

const AUTH_USER = { id: "auth-uid-1" };
const APP_USER_ROW = { data: { id: "app-user-1" }, error: null };
const PUBLIC_CHANNEL = {
  data: {
    id: VALID_BODY.channel_id,
    chapter_id: "chapter-1",
    type: "PUBLIC",
    member_ids: null,
    required_permissions: null,
  },
  error: null,
};
const MEMBER_ROW = { data: { role_ids: [] }, error: null };

// ── Auth / identity ────────────────────────────────────────────────────────

Deno.test("chat-send: missing Authorization header → 401", async () => {
  setNextClient(buildMockClient().client);
  const res = await handler(
    buildRequest({ method: "POST", body: VALID_BODY }),
  );
  assertEquals(res.status, 401);
});

Deno.test("chat-send: invalid JWT → 401 (auth.getUser returns error)", async () => {
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
  // Must not have written anything.
  assertEquals(mock.insertCalls("chat_messages").length, 0);
});

// ── Authz wiring (the §2 predicate-wiring change-detector) ─────────────────

Deno.test("chat-send: non-member of the channel's chapter → 403 (and no insert)", async () => {
  const mock = buildMockClient({
    authGetUser: { data: { user: AUTH_USER }, error: null },
    tables: {
      users: [APP_USER_ROW],
      chat_channels: [PUBLIC_CHANNEL],
      // members lookup returns null → predicate denies for PUBLIC channel.
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
  // The change-detector: insert was NEVER called after authz failed.
  assertEquals(mock.insertCalls("chat_messages").length, 0);
});

// ── Cross-channel reply rejection ──────────────────────────────────────────

Deno.test("chat-send: reply_to_id pointing at a message in a different channel → 400", async () => {
  const mock = buildMockClient({
    authGetUser: { data: { user: AUTH_USER }, error: null },
    tables: {
      users: [APP_USER_ROW],
      chat_channels: [PUBLIC_CHANNEL],
      members: [MEMBER_ROW],
      // The reply target resolves to a DIFFERENT channel_id.
      chat_messages: [
        {
          data: { channel_id: "99999999-9999-9999-9999-999999999999" },
          error: null,
        },
      ],
    },
  });
  setNextClient(mock.client);
  const res = await handler(
    buildRequest({
      method: "POST",
      headers: withBearer("good-jwt"),
      body: {
        ...VALID_BODY,
        reply_to_id: "33333333-3333-3333-3333-333333333333",
      },
    }),
  );
  assertEquals(res.status, 400);
  // The change-detector: the cross-channel reject must happen BEFORE the
  // insert. Even though authz passed, no row was written.
  assertEquals(mock.insertCalls("chat_messages").length, 0);
});

// ── Happy path ─────────────────────────────────────────────────────────────

Deno.test("chat-send: happy path returns 201 with { message } and uses the resolved app user id as sender_id", async () => {
  const insertedRow = {
    id: "msg-new",
    channel_id: VALID_BODY.channel_id,
    sender_id: "app-user-1",
    content: VALID_BODY.content,
  };
  const mock = buildMockClient({
    authGetUser: { data: { user: AUTH_USER }, error: null },
    tables: {
      users: [APP_USER_ROW],
      chat_channels: [PUBLIC_CHANNEL],
      members: [MEMBER_ROW],
      chat_messages: [
        // Insert succeeds, returns one row.
        { data: [insertedRow], error: null },
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
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.message, insertedRow);
  assertEquals(body.deduplicated, false);

  // The insert payload sources sender_id from the trusted users lookup, not
  // from the request body (the §2 "actor identity from session, never client
  // payload" rule).
  const [insertPayload] = mock.insertCalls("chat_messages") as Array<
    Record<string, unknown>
  >;
  assertEquals(insertPayload.sender_id, "app-user-1");
  assertEquals(insertPayload.channel_id, VALID_BODY.channel_id);
  assertEquals(insertPayload.client_message_id, VALID_BODY.client_message_id);
  // And the request never carried a sender_id — make sure we didn't lift one
  // out of an unexpected place.
  assertNotEquals(insertPayload.sender_id, "spoofed");
});
