import { db, miss } from "../harness.mjs";

// ─── `security definer` search_path guard (#985) ─────────────────────────────
//
// Postgres resolves unqualified relation names against `pg_temp` FIRST unless
// `pg_temp` is itself listed in `search_path`. A `security definer` function
// declared `set search_path = public` therefore reads a caller-created temp table
// in place of the real one while holding the DEFINER's privileges. Four of the
// functions this guards are authorization code — `can_read_chat_message` backs
// chat RLS, and the `realtime_can_read_*_scope` trio gates realtime delivery — so
// a shadowed read there is an authorization decision made against attacker-
// supplied rows.
//
// Catalog-driven on purpose. The obvious alternative — grep migration SQL for
// `security definer` without `pg_temp` — cannot work here: migrations are
// immutable, so the three files that introduced the bare setting (20260803150000,
// 20260807220000, 20260816140000) keep it in their text forever. A regex would
// flag them permanently and tempt someone into editing applied history. Reading
// the applied catalog asserts the END STATE instead, which is exactly the query
// #985 specifies, and it catches the eighth function regardless of which file
// declares it or in what syntax.
//
// `pg_temp` must be LAST, so POSITION is asserted rather than mere presence:
// listing it first would reinstate the very shadowing this exists to prevent.
//
// The `search_path` entry is read out of the raw `proconfig` array rather than a
// comma-joined string. A function may carry unrelated settings (`statement_timeout`
// and friends), and in a joined string those are indistinguishable from further
// search_path entries — which would let a genuinely-unpinned function pass.
console.log("\n=== security definer search_path ===");
{
  const res = await db.query(
    `select p.proname,
            (select cfg from unnest(coalesce(p.proconfig, '{}')) as cfg
              where cfg like 'search_path=%' limit 1) as sp
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'public'
      order by p.proname`,
  );
  const offenders = res.rows.filter((r) => {
    if (!r.sp) return true; // security definer with no search_path pinned at all
    const entries = String(r.sp)
      .slice("search_path=".length)
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""));
    return entries[entries.length - 1] !== "pg_temp";
  });
  if (offenders.length === 0) {
    console.log(
      `OK    all ${res.rows.length} security definer function(s) pin pg_temp last in search_path`,
    );
  } else {
    miss();
    console.log(
      `MISS  ${offenders.length} security definer function(s) without pg_temp last in search_path` +
        `\n        \u21b3 ${offenders.map((o) => `${o.proname} (${o.sp ?? "<no search_path>"})`).join("; ")}` +
        `\n        \u21b3 fix: declare \`set search_path = public, pg_temp\` with pg_temp LAST (#985)`,
    );
  }
}

// ─── every `public` function pins search_path (#830) ─────────────────────────
//
// The advisor's lint 0011 (`function_search_path_mutable`) counted 14, then 20:
// each new function was written by a different change, and nothing made any of
// them pin it. This asserts the end state for every function in `public`,
// SECURITY INVOKER included: some `search_path` is set. The `pg_temp`-last rule
// stays the definer check's above, because only a definer function lends its
// owner's privileges to a caller's temp table; an invoker function reads it with
// the caller's own. Functions an extension owns are the extension's business.
{
  const res = await db.query(
    `select p.proname,
            (select cfg from unnest(coalesce(p.proconfig, '{}')) as cfg
              where cfg like 'search_path=%' limit 1) as sp
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind in ('f', 'p')
        and not exists (
          select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
        )
      order by p.proname`,
  );
  const offenders = res.rows.filter(
    (r) => !r.sp || String(r.sp).slice("search_path=".length).trim() === "",
  );
  if (offenders.length === 0) {
    console.log(
      `OK    all ${res.rows.length} public function(s) pin search_path`,
    );
  } else {
    miss();
    console.log(
      `MISS  ${offenders.length} public function(s) with a role-mutable search_path` +
        `\n        ↳ ${offenders.map((o) => `${o.proname} (${o.sp ?? "<no search_path>"})`).join("; ")}` +
        `\n        ↳ fix: add \`set search_path = public, pg_temp\` to the function (#830)`,
    );
  }
}

// ─── who may call a SECURITY DEFINER function (#830) ─────────────────────────
//
// The advisor's lints 0028 and 0029, read off the catalog. `run.mjs` installs
// Supabase's default privileges before the migrations, so a function here is
// granted to `anon` and `authenticated` exactly as on the hosted project, and a
// migration that revokes PUBLIC alone fails here as it would have failed there.
//
// - No definer function is callable by `anon` (lint 0028).
// - The ones callable by `authenticated` (lint 0029) are exactly the accepted
//   set: each backs an RLS policy or a Realtime authorization check that runs
//   as the signed-in caller, so revoking it would break that check. Recorded in
//   `docs/security/authorization-model.md`. A new definer function that needs
//   the grant is added to both, as a decision; one that does not, revokes it.
// - Trigger functions are never callable, since a trigger needs no grant.
const ACCEPTED_AUTHENTICATED_DEFINERS = [
  "can_read_chat_channel",
  "can_read_chat_message",
  "chat_viewer_has_blocked",
  "realtime_can_read_chapter_scope",
  "realtime_can_read_event_scope",
  "realtime_can_read_user_scope",
];
{
  const res = await db.query(
    `select p.proname,
            p.prorettype = 'trigger'::regtype as is_trigger,
            has_function_privilege('anon', p.oid, 'execute') as anon_x,
            has_function_privilege('authenticated', p.oid, 'execute') as auth_x
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosecdef
        and not exists (
          select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
        )
      order by p.proname`,
  );
  const anonCallable = res.rows.filter((r) => r.anon_x).map((r) => r.proname);
  if (anonCallable.length === 0) {
    console.log(
      `OK    no security definer function is callable by anon (${res.rows.length} checked)`,
    );
  } else {
    miss();
    console.log(
      `MISS  security definer function(s) callable by anon: ${anonCallable.join(", ")}` +
        `\n        ↳ fix: \`revoke all on function ... from public\` AND \`from anon\`: Supabase grants anon directly (#830)`,
    );
  }

  const authCallable = res.rows.filter((r) => r.auth_x);
  const triggers = authCallable
    .filter((r) => r.is_trigger)
    .map((r) => r.proname);
  const unaccepted = authCallable
    .filter((r) => !r.is_trigger)
    .map((r) => r.proname)
    .filter((name) => !ACCEPTED_AUTHENTICATED_DEFINERS.includes(name));
  const lost = ACCEPTED_AUTHENTICATED_DEFINERS.filter(
    (name) => !authCallable.some((r) => r.proname === name),
  );
  if (triggers.length === 0 && unaccepted.length === 0 && lost.length === 0) {
    console.log(
      `OK    security definer functions callable by authenticated are exactly the ${ACCEPTED_AUTHENTICATED_DEFINERS.length} accepted ones`,
    );
  } else {
    miss();
    const parts = [];
    if (triggers.length > 0) {
      parts.push(
        `trigger functions callable as RPCs: ${triggers.join(", ")} (revoke from authenticated; a trigger needs no grant)`,
      );
    }
    if (unaccepted.length > 0) {
      parts.push(
        `not in the accepted set: ${unaccepted.join(", ")} (revoke it, or accept it here and in authorization-model.md)`,
      );
    }
    if (lost.length > 0) {
      parts.push(
        `accepted but no longer callable: ${lost.join(", ")} (its RLS or Realtime check needs the grant)`,
      );
    }
    console.log(
      `MISS  security definer grants to authenticated drifted (#830)` +
        parts.map((p) => `\n        ↳ ${p}`).join(""),
    );
  }
}
