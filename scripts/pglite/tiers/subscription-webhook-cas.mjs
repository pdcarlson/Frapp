import { db, miss } from "../harness.mjs";

// ─── `apply_subscription_webhook` CAS (#731 / #1979) ────────────────────────
//
// `CREATE FUNCTION` on a plpgsql body is a syntax check only. The unit suite
// mocks the repository, so a flipped `<=` to `<` (or dropping the mark stamp)
// stays green. This section inserts two chapters and applies older-then-newer
// vs newer-then-older; the newer status must win both commit orders. #1979
// adds `previous_subscription_status` on the return so notify can key off
// the committed row; two into-past_due applies must report active then
// past_due.
console.log("\n=== apply_subscription_webhook CAS (#731 / #1979) ===");
try {
  const CH_OLD_FIRST = "cccccccc-0000-4000-8000-000000000001";
  const CH_NEW_FIRST = "cccccccc-0000-4000-8000-000000000002";
  const T_OLD = "2026-06-01T12:00:00Z";
  const T_NEW = "2026-06-02T12:00:00Z";

  await db.exec(`
    insert into public.chapters (id, name, university, subscription_status) values
      ('${CH_OLD_FIRST}', 'CAS old-first', 'U', 'active'),
      ('${CH_NEW_FIRST}', 'CAS new-first', 'U', 'active');
  `);

  const apply = async (chapter, eventAt, patch) => {
    const r = await db.query(
      `select (applied).subscription_status as subscription_status,
              (applied).last_stripe_webhook_at as last_stripe_webhook_at,
              (applied).past_due_since as past_due_since,
              previous_subscription_status
         from apply_subscription_webhook($1::uuid, $2::timestamptz, $3::jsonb)`,
      [chapter, eventAt, JSON.stringify(patch)],
    );
    return r.rows;
  };

  const row = async (chapter) => {
    const r = await db.query(
      `select subscription_status, last_stripe_webhook_at::text as last_stripe_webhook_at,
              past_due_since::text as past_due_since
         from public.chapters where id = $1::uuid`,
      [chapter],
    );
    return r.rows[0];
  };

  const oldFirstOlder = await apply(CH_OLD_FIRST, T_OLD, {
    subscription_status: "past_due",
  });
  const oldFirstNewer = await apply(CH_OLD_FIRST, T_NEW, {
    subscription_status: "canceled",
  });
  const newFirstNewer = await apply(CH_NEW_FIRST, T_NEW, {
    subscription_status: "canceled",
  });
  const newFirstOlder = await apply(CH_NEW_FIRST, T_OLD, {
    subscription_status: "past_due",
  });

  const afterOldFirst = await row(CH_OLD_FIRST);
  const afterNewFirst = await row(CH_NEW_FIRST);

  const checks = [
    [
      oldFirstOlder.length === 1 && oldFirstOlder[0].subscription_status === "past_due",
      `old-first: older event applies (got ${oldFirstOlder.length} row(s))`,
    ],
    [
      oldFirstOlder[0]?.previous_subscription_status === "active",
      `old-first: older event reports previous=active (got ${oldFirstOlder[0]?.previous_subscription_status})`,
    ],
    [
      oldFirstNewer.length === 1 && oldFirstNewer[0].subscription_status === "canceled",
      `old-first: newer event overwrites (got ${oldFirstNewer[0]?.subscription_status})`,
    ],
    [
      afterOldFirst?.subscription_status === "canceled",
      `old-first: stored status is canceled (got ${afterOldFirst?.subscription_status})`,
    ],
    [
      newFirstNewer.length === 1 && newFirstNewer[0].subscription_status === "canceled",
      `new-first: newer event applies (got ${newFirstNewer.length} row(s))`,
    ],
    [
      newFirstOlder.length === 0,
      `new-first: older event loses the CAS (got ${newFirstOlder.length} row(s))`,
    ],
    [
      afterNewFirst?.subscription_status === "canceled",
      `new-first: stored status stays canceled (got ${afterNewFirst?.subscription_status})`,
    ],
  ];

  const CH_ACTIVATE = "cccccccc-0000-4000-8000-000000000003";
  const CH_CLOCK = "cccccccc-0000-4000-8000-000000000004";
  const CH_RECOVER = "cccccccc-0000-4000-8000-000000000005";
  const CH_RESTART = "cccccccc-0000-4000-8000-000000000006";
  await db.exec(`
    insert into public.chapters (id, name, university, subscription_status, past_due_since) values
      ('${CH_ACTIVATE}', 'CAS activate_if', 'U', 'canceled', null),
      ('${CH_CLOCK}', 'CAS past_due clock', 'U', 'active', null),
      ('${CH_RECOVER}', 'CAS activate recover', 'U', 'past_due', '${T_OLD}'),
      ('${CH_RESTART}', 'CAS clock restart', 'U', 'canceled', null);
  `);

  const activateCanceled = await apply(CH_ACTIVATE, T_NEW, {
    activate_if: ["past_due", "incomplete"],
  });
  const afterActivate = await row(CH_ACTIVATE);

  const clockFirst = await apply(CH_CLOCK, T_OLD, {
    subscription_status: "past_due",
    past_due_since: T_OLD,
  });
  const clockSecond = await apply(CH_CLOCK, T_NEW, {
    subscription_status: "past_due",
    past_due_since: T_NEW,
  });
  const afterClock = await row(CH_CLOCK);

  const recover = await apply(CH_RECOVER, T_NEW, {
    activate_if: ["past_due", "incomplete"],
  });
  const afterRecover = await row(CH_RECOVER);

  const restart = await apply(CH_RESTART, T_NEW, {
    subscription_status: "past_due",
    past_due_since: T_NEW,
  });
  const afterRestart = await row(CH_RESTART);

  checks.push(
    [
      activateCanceled.length === 1 &&
        afterActivate?.subscription_status === "canceled",
      `activate_if on canceled does not un-cancel (got ${afterActivate?.subscription_status})`,
    ],
    [
      afterActivate?.last_stripe_webhook_at != null,
      `activate_if on canceled still stamps the mark`,
    ],
    [
      recover.length === 1 && afterRecover?.subscription_status === "active",
      `activate_if on past_due activates (got ${afterRecover?.subscription_status})`,
    ],
    [
      afterRecover?.past_due_since == null,
      `activate_if on past_due clears the grace clock`,
    ],
    [
      clockFirst.length === 1 && clockFirst[0].subscription_status === "past_due",
      `clock: first past_due applies`,
    ],
    [
      clockFirst[0]?.previous_subscription_status === "active",
      `clock: first past_due reports previous=active (got ${clockFirst[0]?.previous_subscription_status})`,
    ],
    [
      clockSecond.length === 1 &&
        String(afterClock?.past_due_since ?? "").includes("2026-06-01"),
      `clock: second past_due keeps T_OLD (got ${afterClock?.past_due_since})`,
    ],
    [
      clockSecond[0]?.previous_subscription_status === "past_due",
      `clock: second past_due reports previous=past_due (got ${clockSecond[0]?.previous_subscription_status})`,
    ],
    [
      restart.length === 1 &&
        restart[0]?.previous_subscription_status === "canceled" &&
        String(afterRestart?.past_due_since ?? "").includes("2026-06-02"),
      `clock: canceled→past_due restarts the stamp (got previous=${restart[0]?.previous_subscription_status} since=${afterRestart?.past_due_since})`,
    ],
  );

  let activateIfNullOk = false;
  try {
    const nullPatch = await apply(CH_ACTIVATE, T_NEW, { activate_if: null });
    activateIfNullOk =
      nullPatch.length === 1 &&
      (await row(CH_ACTIVATE))?.subscription_status === "canceled";
  } catch (e) {
    activateIfNullOk = false;
    console.log(
      `MISS  activate_if JSON null must not raise (got ${String(e?.message ?? e).split("\n")[0]})`,
    );
  }
  checks.push([
    activateIfNullOk,
    `activate_if JSON null is ignored (does not raise, does not un-cancel)`,
  ]);

  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name}`);
    }
  }

  await db.exec(`
    delete from public.chapters where id in (
      '${CH_OLD_FIRST}', '${CH_NEW_FIRST}', '${CH_ACTIVATE}', '${CH_CLOCK}',
      '${CH_RECOVER}', '${CH_RESTART}'
    );
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  apply_subscription_webhook CAS\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
