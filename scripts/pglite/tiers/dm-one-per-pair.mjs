import { db, miss } from "../harness.mjs";

console.log("\n=== Functional: one 1:1 DM per chapter and member pair (#2788) ===");
{
  // The pair index is the whole fix: the API's createDm relies on its 23505 to
  // hand a racing call the DM that won, and every unit suite mocks the
  // repository. So this is the CI-run proof that the index and the CHECK exist
  // and mean what they say (the live-PostgREST race test,
  // apps/api/test/integration/chat-dm-pair.integration-spec.ts, isn't run in CI).
  const A = "a2788000-0000-4000-8000-00000000000a";
  const B = "a2788000-0000-4000-8000-00000000000b";
  const LOW = "a2788000-0000-4000-8000-000000000001";
  const HIGH = "a2788000-0000-4000-8000-000000000002";
  const THIRD = "a2788000-0000-4000-8000-000000000003";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  // Postgres aborts the transaction on an error, so each attempt runs under
  // its own savepoint and is rolled back to it.
  const refused = async (sql) => {
    await db.exec("savepoint p2788;");
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p2788;");
    }
  };
  const dm = (chapter, name, members, type = "DM") =>
    `insert into chat_channels (chapter_id, name, type, member_ids)
     values ('${chapter}', '${name}', '${type}', ${members === null ? "null" : `'{${members.join(",")}}'`});`;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      ${dm(A, `dm-${LOW}-${HIGH}`, [LOW, HIGH])}
    `);

    const reversedRenamed = await refused(dm(A, "renamed by an officer", [HIGH, LOW]));
    check(
      "a second DM for the pair is refused, whatever its member order or name",
      /chat_channels_dm_pair_key/.test(reversedRenamed ?? ""),
      { reversedRenamed },
    );

    const otherChapter = await refused(dm(B, `dm-${LOW}-${HIGH}`, [LOW, HIGH]));
    const groupDms = await refused(
      dm(A, "group one", [LOW, HIGH], "GROUP_DM") + dm(A, "group two", [LOW, HIGH], "GROUP_DM"),
    );
    check(
      "the same pair may have a DM in another chapter, and group DMs are untouched",
      otherChapter === null && groupDms === null,
      { otherChapter, groupDms },
    );

    const one = await refused(dm(A, "one", [THIRD]));
    const three = await refused(dm(A, "three", [LOW, HIGH, THIRD]));
    const none = await refused(dm(A, "none", null));
    check(
      "a DM without exactly two members is refused",
      [one, three, none].every((e) => /chat_channels_dm_two_members/.test(e ?? "")),
      { one, three, none },
    );
  } catch (e) {
    check("one-DM-per-pair scenario ran", false, String(e?.message ?? e).split("\n")[0]);
  } finally {
    await db.exec("rollback;").catch(() => {});
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(`MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail ?? null).slice(0, 300)}`);
    }
  }
}
