import { db, miss } from "../harness.mjs";
import { ANON_KEY, probeAs, signedIn } from "../probe.mjs";

// ─── AI usage ledger and caps (#714) ─────────────────────────────────────────
//
// `ai_usage_events` and its functions are reached from the API only through a
// mocked client, so this is where their SQL runs, called the way
// `SupabaseAiUsageRepository` calls them. What each check pins:
// - a hold lands exactly on a cap and is granted; one cent more is refused,
//   and the refusal names the cap: platform first, then chapter, then member;
// - an unsettled hold counts at its hold, a settled one at its real cost, so
//   settling frees what the call did not use;
// - the member's cap is per day (UTC) in one chapter, the chapter's and the
//   platform's per calendar month, and a new month starts from zero;
// - the platform cap counts every chapter, per provider;
// - settling only matches a hold in the caller's chapter, and only once;
// - a call the provider never reported is charged its whole hold, marked as
//   an estimate;
// - an expired hold keeps counting, and can still be settled;
// - the usage query sums one chapter's period by task, holds at their hold;
// - the table refuses a settled row without its outcome and cost;
// - no client role reads the table or calls a function.
console.log("\n=== AI usage ledger and caps (#714) ===");
try {
  const CH = "a1a1a1a1-0000-4000-8000-000000000714";
  const CH2 = "a1a1a1a1-0000-4000-8000-000000000715";
  const U = "a3a3a3a3-0000-4000-8000-000000000714";
  const U2 = "a3a3a3a3-0000-4000-8000-000000000715";
  const T0 = "2026-11-12T10:00:00Z";

  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'AI ledger', 'U'),
      ('${CH2}', 'AI ledger two', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U}', gen_random_uuid(), 'ai-ledger@example.com', 'Officer'),
      ('${U2}', gen_random_uuid(), 'ai-ledger-2@example.com', 'Member');
  `);

  const rejects = async (sql, params = []) => {
    try {
      await db.query(sql, params);
      return false;
    } catch {
      return true;
    }
  };
  // Caps in micro-USD; null is none.
  const caps = (over = {}) => ({
    chapter: 1_000_000,
    member: 400_000,
    platform: 5_000_000,
    ...over,
  });
  const reserve = async ({
    chapter = CH,
    user = U,
    provider = "anthropic",
    cost,
    now = T0,
    cap = caps(),
  }) =>
    (
      await db.query(
        `select * from reserve_ai_spend($1, $2, null, 'minutes.draft', 'meetings',
           $3, 'claude-sonnet-5-5', 'minutes@v1', $4, $5, $6, $7, $8::timestamptz)`,
        [
          chapter,
          user,
          provider,
          cost,
          cap.chapter,
          cap.member,
          cap.platform,
          now,
        ],
      )
    ).rows[0];
  const settle = async ({
    id,
    chapter = CH,
    cost,
    bill = false,
    outcome = "completed",
    errorKind = null,
    now = T0,
  }) =>
    (
      await db.query(
        `select settle_ai_spend($1, $2, $3, null, 'minutes.draft', 'meetings',
           'anthropic', 'claude-sonnet-5-5', 'minutes@v1', $4, $5, 10, 20, 0,
           $6, $7, 1500, $8::timestamptz) as result`,
        [id, chapter, U, outcome, errorKind, cost, bill, now],
      )
    ).rows[0].result;
  const row = async (id) =>
    (
      await db.query(
        `select status, outcome, cost_micro_usd::bigint as cost,
                reserved_cost_micro_usd::bigint as reserved, cost_estimated
           from ai_usage_events where id = $1`,
        [id],
      )
    ).rows[0];
  const checks = [];

  // Exactly at the member cap: granted. One more micro-dollar: refused.
  const a = await reserve({ cost: 400_000 });
  const b = await reserve({ cost: 1 });
  checks.push([
    a.reservation_id !== null &&
      a.refused === null &&
      b.reservation_id === null &&
      b.refused === "member_cap",
    "a hold that lands exactly on the member's cap is granted; one more is refused as member_cap",
  ]);
  checks.push([
    Number(a.platform_spent_before) === 0 &&
      Number(a.platform_spent_after) === 400_000,
    "a granted hold reports the provider's month before and after it",
  ]);

  // Settling at the real cost frees the rest of the hold.
  const settled = await settle({ id: a.reservation_id, cost: 100_000 });
  const c = await reserve({ cost: 300_000 });
  checks.push([
    settled === "settled" &&
      c.reservation_id !== null &&
      (await row(a.reservation_id)).status === "settled",
    "settling a hold at its real cost frees what the call did not use",
  ]);

  // Settling twice, or from another chapter, matches nothing.
  checks.push([
    (await settle({ id: a.reservation_id, cost: 100_000 })) === "missing" &&
      (await settle({ id: c.reservation_id, chapter: CH2, cost: 1 })) ===
        "missing" &&
      (await row(c.reservation_id)).status === "reserved",
    "a hold settles once, and only from its own chapter",
  ]);

  // Another member of the chapter has their own day, and the chapter's month
  // is shared: 100k + 300k held so far, cap 1M.
  const d = await reserve({ user: U2, cost: 400_000 });
  const e = await reserve({ user: U2, cost: 300_000 });
  checks.push([
    d.reservation_id !== null &&
      e.reservation_id === null &&
      e.refused === "chapter_cap",
    "the chapter's month is shared by its members: a hold past it is refused as chapter_cap",
  ]);

  // The member's day turns at midnight UTC; the chapter's month does not.
  const nextDay = "2026-11-13T00:00:01Z";
  const f = await reserve({ cost: 200_000, now: nextDay });
  const g = await reserve({ cost: 200_000, now: nextDay });
  checks.push([
    f.reservation_id !== null && g.refused === "chapter_cap",
    "a new day gives the member room again; the chapter's month still binds",
  ]);

  // A new month starts the chapter from zero.
  const h = await reserve({ cost: 400_000, now: "2026-12-01T00:00:00Z" });
  checks.push([
    h.reservation_id !== null,
    "a new calendar month (UTC) starts the chapter's cap from zero",
  ]);

  // The platform cap counts every chapter, per provider, in its own month.
  // Chapter two has its own room, but the provider's November is at 1.0M of
  // a 1.3M cap (chapter one's December hold is not November's).
  const i = await reserve({
    chapter: CH2,
    user: U2,
    cost: 400_000,
    cap: caps({ platform: 1_300_000 }),
  });
  const j = await reserve({
    chapter: CH2,
    user: U2,
    provider: "google",
    cost: 100_000,
    cap: caps({ platform: 1_300_000 }),
  });
  // Lands exactly on the provider's cap (and on the member's day).
  const i2 = await reserve({
    chapter: CH2,
    user: U2,
    cost: 300_000,
    cap: caps({ platform: 1_300_000 }),
  });
  checks.push([
    i.reservation_id === null &&
      i.refused === "platform_cap" &&
      i2.reservation_id !== null &&
      j.reservation_id !== null,
    "the platform cap counts every chapter's spend on that provider, and only that provider",
  ]);

  // Null caps are none.
  const k = await reserve({
    chapter: CH2,
    user: U2,
    provider: "scripted",
    cost: 50_000_000,
    cap: { chapter: null, member: null, platform: null },
  });
  checks.push([
    k.reservation_id !== null &&
      Number(k.platform_spent_before) === 0 &&
      Number(k.platform_spent_after) === 0,
    "a null cap is no cap, and with no platform cap the provider is not summed",
  ]);

  // A call the provider never reported is charged its whole hold.
  const abandoned = await settle({
    id: d.reservation_id,
    cost: 0,
    bill: true,
    outcome: "error",
    errorKind: "aborted",
  });
  const dRow = await row(d.reservation_id);
  checks.push([
    abandoned === "settled" &&
      Number(dRow.cost) === 400_000 &&
      dRow.cost_estimated === true &&
      dRow.outcome === "error",
    "an abandoned stream is charged its whole hold and marked as an estimate",
  ]);

  // Expiry: holds older than the cut become expired and keep counting.
  const expired = (
    await db.query(
      `select expire_ai_spend_holds('2026-11-12T23:00:00Z'::timestamptz) as n`,
    )
  ).rows[0].n;
  const cRow = await row(c.reservation_id);
  const fRow = await row(f.reservation_id);
  checks.push([
    expired >= 1 && cRow.status === "expired" && fRow.status === "reserved",
    "the sweep expires only holds older than the cut",
  ]);
  const usageAfterExpiry = (
    await db.query(
      `select sum(cost_micro_usd)::bigint as cost, sum(unsettled_calls)::bigint as open
         from ai_chapter_usage($1, '2026-11-01'::timestamptz, '2026-12-01'::timestamptz)`,
      [CH],
    )
  ).rows[0];
  // November in chapter one: a settled 100k, c expired at its 300k hold, d
  // charged its 400k hold, f held at 200k.
  checks.push([
    Number(usageAfterExpiry.cost) === 1_000_000 &&
      Number(usageAfterExpiry.open) === 2,
    "the usage query sums one chapter's month, holds and expired holds at their hold",
  ]);
  checks.push([
    (await settle({ id: c.reservation_id, cost: 50_000 })) === "settled" &&
      Number((await row(c.reservation_id)).cost) === 50_000,
    "an expired hold can still be settled with its real cost",
  ]);

  // A call made with no hold is recorded as settled.
  checks.push([
    (await settle({ id: null, cost: 7 })) === "inserted",
    "a call with no hold is recorded as a settled row",
  ]);

  // The table's shape.
  checks.push([
    await rejects(
      `insert into ai_usage_events (chapter_id, task, family, provider, model,
         prompt_version, status, reserved_cost_micro_usd)
       values ($1, 'minutes.draft', 'meetings', 'anthropic', 'm', 'p@v1', 'settled', 0)`,
      [CH],
    ),
    "a settled row must carry its outcome, cost and settle time",
  ]);
  checks.push([
    !(
      await db.query(
        `select 1 from information_schema.columns
          where table_name = 'ai_usage_events'
            and column_name ~ '(text|prompt$|answer|content|body|message)'`,
      )
    ).rows.length,
    "the ledger has no text column",
  ]);
  checks.push([
    await rejects(
      `select * from reserve_ai_spend($1, $2, null, 'minutes.draft',
       'meetings', 'anthropic', 'm', 'p@v1', -1, null, null, null, now())`,
      [CH, U],
    ),
    "a negative hold is refused",
  ]);

  // A hard delete of the member keeps the chapter's spend. (Account deletion
  // in the product tombstones the users row instead, `anonymize_user`, so the
  // row keeps its user id; this is the foreign key's own behaviour.)
  await db.query(`delete from users where id = $1`, [U2]);
  checks.push([
    (
      await db.query(
        `select count(*)::int as n from ai_usage_events
          where chapter_id = $1 and user_id is null`,
        [CH],
      )
    ).rows[0].n >= 1,
    "a hard-deleted user's spend stays with the chapter, unattributed",
  ]);

  // Client roles, in a rolled-back transaction as `ai-runs.mjs` does, with a
  // SELECT grant so "reads nothing" means RLS rather than a missing privilege.
  await db.exec(`
    begin;
    create role rls_probe nologin;
    grant authenticated to rls_probe;
    grant usage on schema public to rls_probe;
    grant select on public.ai_usage_events to rls_probe;
    create role rls_probe_anon nologin;
    grant anon to rls_probe_anon;
    grant usage on schema public to rls_probe_anon;
    grant select on public.ai_usage_events to rls_probe_anon;
  `);
  const readers = [
    await probeAs(signedIn(U), "select id from ai_usage_events"),
    await probeAs(ANON_KEY, "select id from ai_usage_events"),
  ];
  await db.exec("rollback;");
  checks.push([
    readers.every((probe) => probe.failure === null && probe.rows.length === 0),
    "no client role reads the ledger, not even the member who spent it",
  ]);
  const execute = async (role, fn) =>
    (
      await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [
        role,
        fn,
      ])
    ).rows[0].ok;
  const fns = [
    "public.reserve_ai_spend(uuid, uuid, uuid, text, text, text, text, text, bigint, bigint, bigint, bigint, timestamptz)",
    "public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz)",
    "public.expire_ai_spend_holds(timestamptz)",
    "public.ai_chapter_usage(uuid, timestamptz, timestamptz)",
  ];
  let clientCanCall = false;
  for (const role of ["anon", "authenticated"]) {
    for (const fn of fns) {
      if (await execute(role, fn)) clientCanCall = true;
    }
  }
  checks.push([!clientCanCall, "no client role may call a ledger function"]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#714)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${CH2}');
    delete from users where id in ('${U}', '${U2}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  AI usage ledger (#714)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
