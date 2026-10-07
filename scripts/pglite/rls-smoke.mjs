// ─── RLS smoke (ADR-12) ─────────────────────────────────────────────────────
//
// Frapp's data model is default-deny RLS + service-role bypass: the API holds
// the service-role key and enforces access control in NestJS, while direct
// Supabase-client access is denied unless a policy explicitly opens it. This
// tier guards that invariant by asserting policy *presence* and shape. The
// black-box tier further down then reads the tables as a non-owner role to
// check that the policies actually behave; what neither can do is mint a real
// GoTrue JWT, which stays with the NestJS Jest tier.

// Tables intentionally exempt from the "RLS enabled" invariant. Empty today —
// all 48 tables enable RLS. Add a table here ONLY with a reviewed justification
// (e.g. a stateless lookup view), and prefer keeping RLS on with a deny policy.
export const RLS_EXEMPT_TABLES = new Set([]);

export const RLS_SMOKE = [
  {
    name: "RLS enabled on chat_channels + default-deny (no policies)",
    sql: `select c.relrowsecurity as rls,
                 (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
            from pg_class c where c.relname = 'chat_channels'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].rls === true && rows[0].policies === 0,
  },
  {
    name: "RLS enabled on chat_messages",
    sql: `select relrowsecurity from pg_class where relname = 'chat_messages'`,
    ok: (rows) => rows.length === 1 && rows[0].relrowsecurity === true,
  },
  {
    // Was "default-deny (no policies)" until 2026-08-16. That assertion was
    // correct for the schema but described a table nothing could read — and the
    // `postgres_changes` subscription that depended on reading it had been dead
    // since the first deploy (#867: `supabase_realtime` held no tables at all in
    // prod or staging). Repairing the carrier required publishing the table,
    // and Realtime enforces RLS per subscriber, so a policy became mandatory.
    //
    // The landmark is therefore TIGHTENED, not dropped: "no policies" is no
    // longer the invariant, but "no policy broader than channel membership"
    // still is, and that is the property that actually protects the table now
    // that the browser can reach it. Same construction and same caveats as the
    // chat_message_actions assertion below — read its comment for why
    // `rows.length === 1`, `polpermissive` and `polcmd in ('r','*')` are each
    // load-bearing, and for why the expression match is a smoke test rather
    // than a proof.
    name: "chat_messages SELECT gated to authenticated AND scoped via can_read_chat_message (#867)",
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_messages'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    ok: (rows) =>
      rows.length === 1 &&
      /can_read_chat_message\((?:\w+\.)?id\)/.test(rows[0].using_expr ?? "") &&
      /authenticated/.test(rows[0].using_expr ?? "") &&
      // The imported-row exclusion is the Realtime fan-out control, not a
      // cosmetic filter. Supabase Realtime evaluates THIS policy per subscriber
      // (`realtime.apply_rls`), and a publication row filter cannot do the job —
      // `realtime.list_changes` builds wal2json's `add-tables` from table names
      // only and never reads `prqual`. Drop this clause and a bulk archive
      // import fans a frame per row out to every open client.
      /kind\s*<>\s*'imported'/i.test(rows[0].using_expr ?? ""),
  },
  {
    name: "RLS enabled on chat_message_actions",
    sql: `select relrowsecurity from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relrowsecurity === true,
  },
  {
    name: "chat_message_actions SELECT gated to authenticated AND scoped via can_read_chat_message (FRA-38)",
    // `polcmd in ('r','*')` — a FOR ALL policy (polcmd '*') also applies to SELECT
    // and OR-s in, so filtering on 'r' alone would let `for all using (true)`
    // reopen the leak with this assertion still green.
    // `polpermissive` — only permissive policies OR together. A RESTRICTIVE policy
    // can only narrow, so counting one would fail CI on a legitimate hardening.
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    // EXACTLY ONE permissive read-applicable policy, AND-ing the two terms.
    //
    // `rows.length === 1` is the load-bearing half. Postgres OR-s permissive
    // policies together, so a second `using (true)` added later restores "any
    // authenticated user reads every row" — the whole FRA-38 leak — while the
    // hardened policy sits untouched and a `some()` check still passes.
    //
    // The expression check is a cheap smoke test, NOT a proof. It is substring
    // shaped, so a determined rewrite slips past it — `... AND
    // can_read_chat_message(message_id) IS NOT NULL` is constant-true (the helper
    // is an `exists`, never null), and De Morgan spells an OR using only `AND`
    // and `NOT`. The real enforcement guarantee comes from the black-box tier
    // below, which reads the table as an unprivileged role; treat this assertion
    // as "the policy still looks like what we wrote", nothing stronger.
    //
    // `message_id` is matched with an optional table qualifier because hoisting
    // the helper into an initplan — `(select can_read_chat_message(message_id))`,
    // the FRA-291 optimization — makes Postgres render it as
    // `chat_message_actions.message_id`. Likewise `auth.role()` is accepted in the
    // initplan form `( SELECT auth.role() AS role)`.
    ok: (rows) => {
      if (rows.length !== 1) return false;
      const e = String(rows[0].using_expr);
      return (
        /auth\.role\(\)/i.test(e) &&
        /'authenticated'/i.test(e) &&
        /can_read_chat_message\s*\(\s*(?:\w+\.)?message_id\s*\)/i.test(e) &&
        /\band\b/i.test(e) &&
        !/\bor\b/i.test(e)
      );
    },
  },
  {
    name: "chat_message_actions SELECT withholds a blocked member's reactions via chat_viewer_has_blocked (#2494)",
    // The same smoke-test caveat as the assertion above: this says the policy
    // still carries the block clause, and the block-enforcement tier below is
    // what proves the clause hides the right rows. Kept separate from the
    // FRA-38 assertion so a lost block clause fails with its own name.
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions'
             and p.polpermissive
             and p.polcmd in ('r', '*')`,
    ok: (rows) => {
      if (rows.length !== 1) return false;
      const e = String(rows[0].using_expr);
      return (
        /\bnot\b/i.test(e) &&
        /starts_with\s*\(\s*(?:\w+\.)?action_type\s*,\s*'reaction:'/i.test(e) &&
        /chat_viewer_has_blocked\s*\(\s*(?:\w+\.)?user_id\s*,\s*(?:\w+\.)?message_id\s*\)/i.test(e)
      );
    },
  },
  {
    name: "chat_viewer_has_blocked() EXECUTE is revoked from PUBLIC and anon",
    // Same reasoning, and the same default-privileges limitation, as the
    // can_read_chat_message() assertion below. The helper answers only about
    // the caller's own block list, so an RPC call leaks nothing today; the
    // revoke keeps it that way if a later edit adds a parameter.
    sql: `select has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'chat_viewer_has_blocked'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].public_exec === false && rows[0].anon_exec === false,
  },
  {
    name: "users stays default-deny to client roles (the invariant that closes the action-write path)",
    // chat_message_actions' INSERT/DELETE policies gate on
    // `user_id in (select id from users where supabase_auth_id = auth.uid())`.
    // That subselect is what refuses direct-client writes — but only while `users`
    // has no permissive policy reachable by a client role. Adding a routine
    // "read your own row" policy to `users` would flip cross-channel action writes
    // live without touching chat_message_actions at all. The auth-hook policies
    // added by 20260802120000 are scoped `TO supabase_auth_admin` and don't count.
    sql: `select count(*)::int as n
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'users'
             and p.polpermissive
             and p.polcmd in ('r', '*')
             and (
               p.polroles = '{0}'::oid[]
               or exists (
                 select 1 from pg_roles r
                  where r.oid = any (p.polroles)
                    and r.rolname in ('anon', 'authenticated', 'public')
               )
             )`,
    ok: (rows) => rows.length === 1 && rows[0].n === 0,
  },
  {
    name: "can_read_chat_message() EXECUTE is revoked from PUBLIC and anon (not a wide-open PostgREST RPC oracle)",
    // The helper is SECURITY DEFINER and answers "may I read this message?", so
    // exposing it as an RPC hands out a membership oracle. A later `drop function;
    // create function` silently restores the default PUBLIC grant, so pin it.
    //
    // `anon` is checked directly too, now that the role exists here (#1557):
    // that catches an explicit `grant execute ... to anon` in a migration.
    // LIMITATION: hosted Supabase also grants `anon` EXECUTE through ALTER
    // DEFAULT PRIVILEGES, and this harness does not replay those defaults. So a
    // drop/recreate that restores anon's grant on hosted (by forgetting the
    // `revoke ... from anon`) still leaves this green. For this function the
    // promotion-time `has_function_privilege('anon', ...)` check in
    // docs/ops/database/promotion-log.md covers that case. Not every function has such an
    // entry, so in general nothing does (#3052).
    sql: `select has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
                 has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    ok: (rows) =>
      rows.length === 1 && rows[0].public_exec === false && rows[0].anon_exec === false,
  },
  {
    name: "can_read_chat_message() is SECURITY DEFINER with search_path pinned to exactly `public, pg_temp`",
    sql: `select prosecdef, proconfig
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'can_read_chat_message'`,
    // The pin must be exactly `public, pg_temp` — that list, in that order.
    //
    // This asserted "exactly public" until #985. That was the weaker pin, not the
    // stronger one: omitting `pg_temp` does not exclude the temp schema, it moves it
    // to the FRONT of the resolution order implicitly, so a caller-created temp table
    // shadowed `chat_messages` inside the RLS predicate while it ran with the
    // definer's privileges. Naming `pg_temp` LAST is what demotes it. It is therefore
    // not a widening, and the original intent — reject an extra readable schema like
    // `public, pg_catalog` — is preserved by pinning the exact list rather than
    // merely looking for `pg_temp` somewhere in it.
    //
    // Order is asserted, not just membership: `pg_temp, public` would reinstate the
    // exact shadowing this exists to prevent. The repo-wide version of this check
    // lives in the `security definer search_path` tier below and covers every such
    // function; this landmark stays because this one backs chat RLS and deserves its
    // own named assertion.
    ok: (rows) => {
      if (rows.length !== 1 || rows[0].prosecdef !== true) return false;
      const cfg = rows[0].proconfig;
      // proconfig arrives as a JS array from PGlite; the string branch is
      // defensive. It must NOT split on "," -- the value we are looking for is
      // `search_path=public, pg_temp`, a SINGLE element that itself contains a
      // comma, which Postgres therefore renders quoted inside the array literal.
      // Splitting naively would tear it in half and fail a correctly-pinned
      // function. Match quoted elements whole, unquoted ones up to the next comma.
      const items = Array.isArray(cfg)
        ? cfg
        : ((String(cfg ?? "").replace(/^\{|\}$/g, "").match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []).map(
            (it) => it.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"'),
          ));
      const sp = items
        .map((it) => String(it).trim())
        .find((it) => /^search_path\s*=/i.test(it));
      if (!sp) return false;
      const schemas = sp
        .replace(/^search_path\s*=\s*/i, "")
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, "").toLowerCase());
      return (
        schemas.length === 2 &&
        schemas[0] === "public" &&
        schemas[1] === "pg_temp"
      );
    },
  },
  {
    name: "chat_message_actions keeps DEFAULT replica identity (FULL is permanent WAL cost that cannot feed this policy)",
    // Pins the deliberate choice documented in the migration. Realtime does not
    // apply RLS to DELETE, and with RLS enabled the `old` record is trimmed to
    // primary keys regardless of replica identity — so FULL cannot feed
    // message_id to this policy or to the client, and only adds WAL volume to
    // every delete. 'd' is the default; anything else means someone re-added it
    // on the disproven rationale.
    sql: `select relreplident from pg_class where relname = 'chat_message_actions'`,
    ok: (rows) => rows.length === 1 && rows[0].relreplident === "d",
  },
  {
    name: "chat_message_actions INSERT scoped to the caller's own user_id (auth.uid())",
    sql: `select pg_get_expr(polwithcheck, polrelid) as check_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'a'`,
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some(
        (r) =>
          /user_id/i.test(String(r.check_expr)) &&
          /auth\.uid\(\)/i.test(String(r.check_expr)),
      ),
  },
  {
    name: "chat_message_actions DELETE scoped to the caller's own user_id (auth.uid())",
    sql: `select pg_get_expr(polqual, polrelid) as using_expr
            from pg_policy p join pg_class c on c.oid = p.polrelid
           where c.relname = 'chat_message_actions' and polcmd = 'd'`,
    ok: (rows) =>
      rows.length >= 1 &&
      rows.some(
        (r) =>
          /user_id/i.test(String(r.using_expr)) &&
          /auth\.uid\(\)/i.test(String(r.using_expr)),
      ),
  },
  {
    name: "chapter_audit_log denies UPDATE via RLS policy (qual = false)",
    sql: `select pg_get_expr(polqual, polrelid) as expr
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'chapter_audit_log' and polcmd = 'w'`,
    ok: (rows) =>
      rows.length >= 1 && rows.some((r) => /false/i.test(String(r.expr))),
  },
  {
    name: "chapter_audit_log denies DELETE via RLS policy (qual = false)",
    sql: `select pg_get_expr(polqual, polrelid) as expr
            from pg_policy p
            join pg_class c on c.oid = p.polrelid
           where c.relname = 'chapter_audit_log' and polcmd = 'd'`,
    ok: (rows) =>
      rows.length >= 1 && rows.some((r) => /false/i.test(String(r.expr))),
  },
];
