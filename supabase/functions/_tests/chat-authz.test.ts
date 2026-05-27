// Tests for `supabase/functions/_shared/chat-authz.ts`.
//
// These pin the wiring of the three exported helpers — they do NOT re-litigate
// the `canAccessChannel` predicate matrix, which is already covered by
// `apps/api/src/application/services/chat-access.spec.ts`. The shared
// predicate is exercised indirectly via `assertChannelAccess` so a future
// regression that bypasses or mis-orders the lookups would be caught here.

import { deepStrictEqual as assertEquals } from "node:assert/strict";
import {
  assertChannelAccess,
  assertMessageAccess,
  resolveAppUserId,
} from "../_shared/chat-authz.ts";
import { buildMockClient } from "./test-helpers.ts";

const PUBLIC_CHANNEL = {
  id: "channel-1",
  chapter_id: "chapter-1",
  type: "PUBLIC",
  member_ids: null,
  required_permissions: null,
};

const ROLE_GATED_CHANNEL = {
  id: "channel-2",
  chapter_id: "chapter-1",
  type: "ROLE_GATED",
  member_ids: null,
  required_permissions: ["chat.admin"],
};

// ── resolveAppUserId ───────────────────────────────────────────────────────

Deno.test("resolveAppUserId: returns app user id on hit", async () => {
  const mock = buildMockClient({
    tables: {
      users: [{ data: { id: "app-user-1" }, error: null }],
    },
  });
  const result = await resolveAppUserId(mock.client, "auth-uid-1");
  assertEquals(result, { ok: true, userId: "app-user-1" });
  // Lookup composes correctly: from("users").select("id").eq("supabase_auth_id", ...)
  assertEquals(mock.calls.from[0].table, "users");
  const sel = mock.calls.builder.find((c) => c.method === "select");
  const eq = mock.calls.builder.find((c) => c.method === "eq");
  assertEquals(sel?.args, ["id"]);
  assertEquals(eq?.args, ["supabase_auth_id", "auth-uid-1"]);
});

Deno.test("resolveAppUserId: 404 when the user row is missing", async () => {
  const mock = buildMockClient({
    tables: { users: [{ data: null, error: null }] },
  });
  const result = await resolveAppUserId(mock.client, "auth-uid-missing");
  assertEquals(result, { ok: false, status: 404, message: "User not found" });
});

Deno.test("resolveAppUserId: 500 on DB error (never coerced to 404)", async () => {
  const mock = buildMockClient({
    tables: { users: [{ data: null, error: { message: "boom" } }] },
  });
  const result = await resolveAppUserId(mock.client, "auth-uid-1");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 500);
});

// ── assertChannelAccess ────────────────────────────────────────────────────

Deno.test("assertChannelAccess: 404 when the channel row is missing", async () => {
  const mock = buildMockClient({
    tables: { chat_channels: [{ data: null, error: null }] },
  });
  const result = await assertChannelAccess(
    mock.client,
    "user-1",
    "channel-missing",
  );
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 404);
  assertEquals(result.message, "Channel not found");
  // Should not have looked up `members` after channel-not-found.
  assertEquals(mock.fromCount("members"), 0);
});

Deno.test("assertChannelAccess: 500 on channel-lookup DB error", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: null, error: { message: "db down" } }],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-1");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 500);
});

Deno.test("assertChannelAccess: 403 when the caller is not a chapter member (PUBLIC)", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: PUBLIC_CHANNEL, error: null }],
      members: [{ data: null, error: null }],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-1");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 403);
  assertEquals(result.message, "Forbidden");
  // The membership lookup composed correctly: scoped to the channel's chapter.
  const memberEqs = mock.calls.builder.filter(
    (c) => c.table === "members" && c.method === "eq",
  );
  assertEquals(memberEqs[0]?.args, ["user_id", "user-1"]);
  assertEquals(memberEqs[1]?.args, ["chapter_id", "chapter-1"]);
});

Deno.test("assertChannelAccess: PUBLIC happy path returns ok:true", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: PUBLIC_CHANNEL, error: null }],
      members: [{ data: { role_ids: [] }, error: null }],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-1");
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.channel.id, "channel-1");
  // No roles lookup for a non-ROLE_GATED channel.
  assertEquals(mock.fromCount("roles"), 0);
});

Deno.test("assertChannelAccess: ROLE_GATED with no matching role permissions falls back to deny (403)", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: ROLE_GATED_CHANNEL, error: null }],
      members: [{ data: { role_ids: ["role-1"] }, error: null }],
      // The roles row is missing / empty — effectivePermissions returns [].
      roles: [{ data: [], error: null }],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-2");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 403);
  assertEquals(result.message, "Forbidden");
  // Roles lookup composed correctly: scoped to the channel's chapter (not
  // cross-chapter — that's the comment in `chat-authz.ts:154-156`).
  const rolesEqs = mock.calls.builder.filter(
    (c) => c.table === "roles" && c.method === "eq",
  );
  assertEquals(rolesEqs[0]?.args, ["chapter_id", "chapter-1"]);
  const rolesIn = mock.calls.builder.find(
    (c) => c.table === "roles" && c.method === "in",
  );
  assertEquals(rolesIn?.args, ["id", ["role-1"]]);
});

Deno.test("assertChannelAccess: ROLE_GATED with the required permission allows", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: ROLE_GATED_CHANNEL, error: null }],
      members: [{ data: { role_ids: ["role-1"] }, error: null }],
      roles: [
        { data: [{ permissions: ["chat.admin"] }], error: null },
      ],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-2");
  assertEquals(result.ok, true);
});

Deno.test("assertChannelAccess: 500 on roles-lookup DB error (never silently [])", async () => {
  const mock = buildMockClient({
    tables: {
      chat_channels: [{ data: ROLE_GATED_CHANNEL, error: null }],
      members: [{ data: { role_ids: ["role-1"] }, error: null }],
      roles: [{ data: null, error: { message: "boom" } }],
    },
  });
  const result = await assertChannelAccess(mock.client, "user-1", "channel-2");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 500);
});

// ── assertMessageAccess ────────────────────────────────────────────────────

Deno.test("assertMessageAccess: 404 when the message row is missing", async () => {
  const mock = buildMockClient({
    tables: { chat_messages: [{ data: null, error: null }] },
  });
  const result = await assertMessageAccess(mock.client, "user-1", "msg-missing");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 404);
  assertEquals(result.message, "Message not found");
  // Should not have proceeded into channel/membership lookups.
  assertEquals(mock.fromCount("chat_channels"), 0);
  assertEquals(mock.fromCount("members"), 0);
});

Deno.test("assertMessageAccess: 500 on message-lookup DB error", async () => {
  const mock = buildMockClient({
    tables: {
      chat_messages: [{ data: null, error: { message: "db down" } }],
    },
  });
  const result = await assertMessageAccess(mock.client, "user-1", "msg-1");
  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.status, 500);
});

Deno.test("assertMessageAccess: delegates to assertChannelAccess on hit", async () => {
  const mock = buildMockClient({
    tables: {
      chat_messages: [{ data: { channel_id: "channel-1" }, error: null }],
      chat_channels: [{ data: PUBLIC_CHANNEL, error: null }],
      members: [{ data: { role_ids: [] }, error: null }],
    },
  });
  const result = await assertMessageAccess(mock.client, "user-1", "msg-1");
  assertEquals(result.ok, true);
});
