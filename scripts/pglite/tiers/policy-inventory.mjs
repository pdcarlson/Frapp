import { db, miss } from "../harness.mjs";
import { AUTH_ADMIN_ONLY } from "../rls-smoke.mjs";

// ─── Policy inventory (#977) ────────────────────────────────────────────────
//
// `authorization-model.md` §4 heads its table "The policies that do exist (N
// statements)". That number had drifted and was reconciled by hand, which is
// precisely why it drifted again: nothing re-checked it. This checks it against
// the catalog.
//
// The counting convention, written down because ambiguity was the actual defect:
// **N counts individual policy statements — rows in `pg_policies` — not rows in
// the doc's table**, several of which name two policies each.
//
// PGlite legitimately sees fewer than a hosted project, and both absences are
// schema-gated rather than a defect: `realtime.messages.realtime_messages_
// scoped_select` and `realtime.messages.realtime_messages_scoped_insert` (#1552
// phase 1) live in the `realtime` schema, which PGlite does not have at all.
// (`users.auth_admin_can_read_users` and `members.auth_admin_can_read_members`
// were a third and fourth absence until #1557 created `supabase_auth_admin`,
// whose `if exists` guard in 20260802120000_active_chapter_jwt_claim.sql:137
// they sit behind.) So: 10 in `public` here; 12 hosted (10 in `public` + 2 in
// `realtime`). The printed hosted figure is derived from this list + those 2,
// so it cannot silently contradict itself the way a second hardcoded literal
// would.
//
// Asserted as an exact SET rather than a count: a bare count lets a dropped
// policy be masked by an added one, which is the failure mode that matters — a
// silently removed policy widens access without changing the total.

{
  const HOSTED_ONLY_POLICIES = 2;
  const EXPECTED_PUBLIC_POLICIES = [
    "chapter_audit_log.audit_log_no_delete [DELETE] to {public}",
    "chapter_audit_log.audit_log_no_update [UPDATE] to {public}",
    "chat_message_actions.chat_message_actions_delete [DELETE] to {public}",
    "chat_message_actions.chat_message_actions_insert [INSERT] to {public}",
    "chat_message_actions.chat_message_actions_select [SELECT] to {authenticated}",
    "chat_messages.chat_messages_select [SELECT] to {authenticated}",
    "chat_notification_preferences.chat_notification_preferences_select_own [SELECT] to {public}",
    // FOR ALL, so an in-place rewrite here would widen writes as well as reads —
    // which is why the unconditional check below matters most for this one.
    "member_custom_field_values.member_custom_field_values_service_role [ALL] to {public}",
    "members.auth_admin_can_read_members [SELECT] to {supabase_auth_admin}",
    "users.auth_admin_can_read_users [SELECT] to {supabase_auth_admin}",
  ];
  // `cmd` is part of the identity, not decoration: flipping a policy from SELECT
  // to ALL widens it to writes while the name set is unchanged.
  //
  // So are the roles (#1557). `chat_messages_select` is written through a
  // `v_role_clause` DO block, and a plain `create policy` now works here, so
  // tidying that block into one would be the natural edit — and dropping its
  // `to authenticated` on the way changes neither name nor cmd. The policy
  // then binds `anon` on hosted, where `can_read_chat_message` is not
  // executable by anon: a read returns zero rows or raises 42501 depending on
  // plan shape (security-fixes.md § the chat_message_actions tiers), and
  // `use-chat-channel.ts` discards the error. Naming the roles makes that edit
  // a REMOVED-and-ADDED pair instead of a silent pass.
  const res = await db.query(
    `select tablename, policyname, cmd, permissive,
            roles::text as roles,
            coalesce(qual, '') as qual,
            coalesce(with_check, '') as with_check
       from pg_policies
      where schemaname = 'public'
      order by tablename, policyname`,
  );
  const got = res.rows.map(
    (r) => `${r.tablename}.${r.policyname} [${r.cmd}] to ${r.roles}`,
  );
  const added = got.filter((p) => !EXPECTED_PUBLIC_POLICIES.includes(p));
  const removed = EXPECTED_PUBLIC_POLICIES.filter((p) => !got.includes(p));

  // A name, cmd and roles set still cannot see a policy REWRITTEN in place, and
  // two of these ten have no other coverage anywhere in the repo
  // (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`). Dropping and recreating one with
  // `using (true)` under the same name would keep the set identical and hand
  // every row to any authenticated PostgREST client. None of the eight a client
  // role can reach is unconditional today, so assert that directly.
  //
  // Only a policy a client can reach counts, which is every policy except one
  // bound to `supabase_auth_admin` alone (AUTH_ADMIN_ONLY). The two
  // `auth_admin_can_read_*` policies are `using (true)` by design: that is the
  // role the custom-access-token hook runs as, and no PostgREST request can
  // assume it.
  // BOTH halves, deliberately. `qual` governs reads (and the row a write may
  // target); `with_check` governs what a write may create. A FOR INSERT policy
  // like `chat_message_actions_insert` has a NULL `qual` and carries its entire
  // predicate in `with_check`, so a qual-only check can never fire for it — and
  // on the FOR ALL policy it is `with_check` that gates the write path. Reading
  // only `qual` would leave the write side of both entirely unpinned.
  //
  // This is a tripwire for the obvious rewrite, not a proof: it catches the
  // literal tautologies, and an adversarial `using (id = id)` would still pass.
  // It exists because two of these ten have no other coverage anywhere in the
  // repo (`chat_notification_preferences_select_own`,
  // `member_custom_field_values_service_role`).
  const TAUTOLOGY = /^\s*\(*\s*(true|1\s*=\s*1)\s*\)*\s*$/i;
  const unconditional = res.rows
    .filter(
      (r) =>
        r.permissive === "PERMISSIVE" &&
        r.roles !== AUTH_ADMIN_ONLY &&
        (TAUTOLOGY.test(r.qual) || TAUTOLOGY.test(r.with_check)),
    )
    .map(
      (r) =>
        `${r.tablename}.${r.policyname}` +
        (TAUTOLOGY.test(r.with_check) && !TAUTOLOGY.test(r.qual)
          ? " (with check)"
          : ""),
    );

  // Independent, not mutually exclusive: a migration that both drops a policy
  // and neuters another must report — and count — both. Reporting only one
  // hides "a silently removed policy", which this block's header calls the
  // failure mode that matters.
  let drifted = false;
  if (added.length > 0 || removed.length > 0) {
    drifted = true;
    miss();
    console.log(
      "MISS  public policy inventory drifted from authorization-model.md §4" +
        (added.length
          ? `\n        ↳ ADDED (a new policy widens access — update §4): ${added.join(", ")}`
          : "") +
        (removed.length ? `\n        ↳ REMOVED: ${removed.join(", ")}` : ""),
    );
  }
  if (unconditional.length > 0) {
    drifted = true;
    miss();
    console.log(
      `MISS  a permissive public policy is unconditional (\`true\`)\n        ↳ ${unconditional.join(", ")}`,
    );
  }
  if (!drifted) {
    console.log(
      `OK    public policy inventory matches authorization-model.md §4 (${got.length} here, ${EXPECTED_PUBLIC_POLICIES.length + HOSTED_ONLY_POLICIES} hosted)`,
    );
  }
}
