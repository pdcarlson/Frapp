import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: predictions stake, pay and void (#5133) ===");
{
  // The stake, pay and void functions own the pool math (spec/behavior/
  // predictions.md). Every unit suite mocks them; this is the CI-run proof
  // that a market's ledger rows stay zero-sum through a payout, a re-settle
  // and a void, and that the cap, the balance check and the replay key hold.
  const CHAPTER = "a5133000-0000-4000-8000-00000000000c";
  const CHANNEL = "a5133000-0000-4000-8000-0000000000c1";
  const MARKET = "a5133000-0000-4000-8000-0000000000f1";
  const YES = "a5133000-0000-4000-8000-0000000000b1";
  const NO = "a5133000-0000-4000-8000-0000000000b2";
  const U = (n) => `a5133000-0000-4000-8000-0000000000a${n}`;
  const KEY = (n) =>
    `a5133000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
  const [A, B, C, D, E, CREATOR] = [1, 2, 3, 4, 5, 6].map(U);

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const stake = (user, answer, amount, key) =>
    db.query(
      `select * from place_prediction_stake($1, $2, $3, $4, $5, $6, null, 25)`,
      [CHAPTER, MARKET, answer, user, amount, key],
    );
  const error = async (fn) => {
    await db.exec("savepoint p5133;");
    try {
      await fn();
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p5133;");
    }
  };
  const net = async () =>
    Object.fromEntries(
      (
        await db.query(
          `select user_id, sum(amount)::int as total from point_transactions
            where chapter_id = $1 and category = 'PREDICTION' group by user_id`,
          [CHAPTER],
        )
      ).rows.map((r) => [r.user_id, r.total]),
    );

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'C', 'U');
      insert into users (id, supabase_auth_id, email, display_name)
      select id::uuid, gen_random_uuid(), id || '@example.test', 'M'
        from unnest(array['${A}', '${B}', '${C}', '${D}', '${E}', '${CREATOR}']) as id;
      insert into chat_channels (id, chapter_id, name, type) values ('${CHANNEL}', '${CHAPTER}', 'general', 'PUBLIC');
      insert into point_transactions (chapter_id, user_id, amount, category)
      select '${CHAPTER}', u::uuid, case when u = '${E}' then 3 else 30 end, 'MANUAL'
        from unnest(array['${A}', '${B}', '${C}', '${D}', '${E}']) as u;
      insert into prediction_markets (id, chapter_id, channel_id, created_by, settler_id, question, settle_rule, closes_at)
      values ('${MARKET}', '${CHAPTER}', '${CHANNEL}', '${CREATOR}', '${CREATOR}', 'Q?', 'Rule', now() + interval '1 day');
      insert into prediction_answers (id, market_id, chapter_id, label, position) values
        ('${YES}', '${MARKET}', '${CHAPTER}', 'Yes', 0),
        ('${NO}', '${MARKET}', '${CHAPTER}', 'No', 1);
    `);

    const first = await stake(A, YES, 10, KEY(1));
    const replay = await stake(A, YES, 10, KEY(1));
    check(
      "a replayed stake returns the original row and writes nothing more",
      first.rows[0]?.id === replay.rows[0]?.id && (await net())[A] === -10,
      { first: first.rows[0]?.id, replay: replay.rows[0]?.id },
    );
    check(
      "a key reused for a different stake is refused",
      /key_reused/.test((await error(() => stake(A, YES, 5, KEY(1)))) ?? ""),
    );
    check(
      "a stake past the per-market cap is refused",
      /over_cap/.test((await error(() => stake(A, NO, 16, KEY(2)))) ?? ""),
    );
    check(
      "a stake larger than the member's balance is refused",
      /insufficient_points/.test(
        (await error(() => stake(E, YES, 5, KEY(3)))) ?? "",
      ),
    );

    await stake(B, YES, 5, KEY(4));
    await stake(C, NO, 7, KEY(5));
    await stake(D, NO, 3, KEY(6));

    await db.exec(
      `update prediction_markets set status = 'settled', winning_answer_id = '${YES}' where id = '${MARKET}'`,
    );
    check(
      "a settled market takes no more stakes",
      /not_open/.test((await error(() => stake(D, NO, 1, KEY(7)))) ?? ""),
    );

    await db.exec(
      `update prediction_markets set status = 'questioned' where id = '${MARKET}'`,
    );
    check(
      "the payout sweep leaves a questioned market for an officer",
      /prediction.market.questioned/.test(
        (await error(() =>
          db.query(`select * from pay_prediction_market($1, $2, null, true)`, [
            CHAPTER,
            MARKET,
          ]),
        )) ?? "",
      ),
    );
    await db.exec(
      `update prediction_markets set status = 'settled' where id = '${MARKET}'`,
    );

    await db.query(`select * from pay_prediction_market($1, $2, null)`, [
      CHAPTER,
      MARKET,
    ]);
    let n = await net();
    // Pool 25, Yes 15: A 10*25/15 = 16 r10, B 5*25/15 = 8 r5; the leftover
    // point goes to the larger remainder, A.
    check(
      "a payout splits the pool by stake and gives the leftover to the largest remainder",
      n[A] === 7 && n[B] === 3 && n[C] === -7 && n[D] === -3,
      n,
    );
    check(
      "the market's ledger rows sum to zero after payout",
      Object.values(n).reduce((s, v) => s + v, 0) === 0,
      n,
    );

    // No pool 10: C 7*25/10 = 17 r5, D 3*25/10 = 7 r5. The remainders tie,
    // so the leftover point goes to whoever staked first: D, moved earlier.
    await db.exec(
      `update prediction_stakes set created_at = created_at - interval '1 minute' where user_id = '${D}' and market_id = '${MARKET}'`,
    );
    await db.query(`select * from pay_prediction_market($1, $2, $3)`, [
      CHAPTER,
      MARKET,
      NO,
    ]);
    n = await net();
    check(
      "re-settling a paid market reverses the old payouts and pays the new winners, a tied leftover to the earliest stake",
      n[A] === -10 && n[B] === -5 && n[C] === 10 && n[D] === 5,
      n,
    );

    await db.query(`select * from void_prediction_market($1, $2, $3)`, [
      CHAPTER,
      MARKET,
      CREATOR,
    ]);
    n = await net();
    check(
      "voiding a paid market leaves every staker exactly where they started",
      [A, B, C, D].every((u) => n[u] === 0),
      n,
    );
    check(
      "a voided market can't be voided twice",
      /prediction.market.voided/.test(
        (await error(() =>
          db.query(`select * from void_prediction_market($1, $2, $3)`, [
            CHAPTER,
            MARKET,
            CREATOR,
          ]),
        )) ?? "",
      ),
    );

    // A second market: stakes after the answer became known are refunded.
    const MARKET2 = "a5133000-0000-4000-8000-0000000000f2";
    const MARKET3 = "a5133000-0000-4000-8000-0000000000f3";
    const MARKET4 = "a5133000-0000-4000-8000-0000000000f4";
    const CHANNEL2 = "a5133000-0000-4000-8000-0000000000c2";
    const [Y2, N2, Y3, N3, Y4] = [3, 4, 5, 6, 7].map(
      (i) => `a5133000-0000-4000-8000-0000000000b${i}`,
    );
    await db.exec(`
      insert into chat_channels (id, chapter_id, name, type) values ('${CHANNEL2}', '${CHAPTER}', 'side', 'PUBLIC');
      insert into prediction_markets (id, chapter_id, channel_id, created_by, settler_id, question, settle_rule, closes_at) values
        ('${MARKET2}', '${CHAPTER}', '${CHANNEL}', '${CREATOR}', '${CREATOR}', 'Q2?', 'Rule', now() + interval '1 day'),
        ('${MARKET3}', '${CHAPTER}', '${CHANNEL}', '${CREATOR}', '${CREATOR}', 'Q3?', 'Rule', now() + interval '1 day'),
        ('${MARKET4}', '${CHAPTER}', '${CHANNEL2}', '${CREATOR}', '${CREATOR}', 'Q4?', 'Rule', now() + interval '1 day');
      insert into prediction_answers (id, market_id, chapter_id, label, position) values
        ('${Y2}', '${MARKET2}', '${CHAPTER}', 'Yes', 0), ('${N2}', '${MARKET2}', '${CHAPTER}', 'No', 1),
        ('${Y3}', '${MARKET3}', '${CHAPTER}', 'Yes', 0), ('${N3}', '${MARKET3}', '${CHAPTER}', 'No', 1),
        ('${Y4}', '${MARKET4}', '${CHAPTER}', 'Yes', 0);
    `);
    const stakeOn = (market, user, answer, amount, key) =>
      db.query(
        `select * from place_prediction_stake($1, $2, $3, $4, $5, $6, null, 25)`,
        [CHAPTER, market, answer, user, amount, key],
      );
    const netOn = async (market) =>
      Object.fromEntries(
        (
          await db.query(
            `select user_id, sum(amount)::int as total from point_transactions
              where chapter_id = $1 and category = 'PREDICTION'
                and metadata->>'market_id' = $2 group by user_id`,
            [CHAPTER, market],
          )
        ).rows.map((r) => [r.user_id, r.total]),
      );

    await stakeOn(MARKET2, A, Y2, 4, KEY(20));
    await stakeOn(MARKET2, B, N2, 6, KEY(21));
    await stakeOn(MARKET2, C, Y2, 2, KEY(22));
    await db.exec(`
      update prediction_stakes set created_at = now() - interval '2 hours'
       where market_id = '${MARKET2}' and user_id in ('${A}', '${B}');
      update prediction_markets
         set status = 'settled', winning_answer_id = '${Y2}', known_at = now() - interval '1 hour'
       where id = '${MARKET2}';
    `);
    await db.query(`select * from pay_prediction_market($1, $2, null)`, [
      CHAPTER,
      MARKET2,
    ]);
    n = await netOn(MARKET2);
    check(
      "a stake placed after the answer became known is refunded, and stays out of the pool",
      n[A] === 6 && n[B] === -6 && n[C] === 0,
      n,
    );
    check(
      "the settler's void is refused once the market has paid",
      /prediction.market.paid/.test(
        (await error(() =>
          db.query(`select * from void_prediction_market($1, $2, $3, true)`, [
            CHAPTER,
            MARKET2,
            CREATOR,
          ]),
        )) ?? "",
      ),
    );

    // Nobody staked on the winner: every stake comes back.
    await stakeOn(MARKET3, A, Y3, 3, KEY(30));
    await stakeOn(MARKET3, B, Y3, 2, KEY(31));
    await db.exec(
      `update prediction_markets set status = 'settled', winning_answer_id = '${N3}' where id = '${MARKET3}'`,
    );
    await db.query(`select * from pay_prediction_market($1, $2, null)`, [
      CHAPTER,
      MARKET3,
    ]);
    n = await netOn(MARKET3);
    check(
      "when nobody staked on the winning answer, every stake is refunded",
      n[A] === 0 && n[B] === 0,
      n,
    );

    // Deleting a channel voids the unpaid markets in it before they cascade away.
    await stakeOn(MARKET4, A, Y4, 5, KEY(40));
    await db.exec(`delete from chat_channels where id = '${CHANNEL2}'`);
    n = await netOn(MARKET4);
    const gone = (
      await db.query(`select 1 from prediction_markets where id = $1`, [
        MARKET4,
      ])
    ).rows.length;
    check(
      "deleting a channel refunds the stakes on its open markets",
      n[A] === 0 && gone === 0,
      { n, gone },
    );

    // Deleting the whole chapter still works: there is no one left to refund.
    await db.exec(
      `update prediction_markets set status = 'open' where id = '${MARKET3}'`,
    );
    check(
      "deleting a chapter with prediction markets succeeds",
      (await error(() =>
        db.exec(`delete from chapters where id = '${CHAPTER}'`),
      )) === null,
    );
  } catch (e) {
    check(
      "predictions scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`,
      );
    }
  }
}
