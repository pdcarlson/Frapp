import { db, miss } from "../harness.mjs";

// ─── Functional: a presidency transfer keeps member access (20261108200000) ──
//
// `transfer_presidency` used to strip President and nothing else, so a founder
// holding only President was left with no roles, and one also holding only a
// role without `members:view` was left with just that role: refused on every
// screen either way (#3670). This tier calls the replayed RPC and checks:
//
//   - `{President}` → `{Member}`, and the target gains President;
//   - `{President, Cabinet}` (Cabinet without `members:view`) → `{Cabinet, Member}`;
//   - `{President, Treasurer}` keeps `{Treasurer}`: it already grants access;
//   - a legacy live role carrying `*` counts as access;
//   - a leftover `custom_role_ids` entry no longer counts as access: #4075
//     folded custom roles into `role_ids` (20261111210000), and the RPC
//     reads only `roles`;
//   - a role id in upper case still matches, as the guard compares uuids;
//   - a Member role stripped of `members:view` is not appended a second time;
//   - another chapter's Member role id doesn't count, the way the guard reads it;
//   - a chapter with no Member role still transfers, leaving `{}` as before;
//   - a lost compare-and-set still returns nothing and changes nothing.
//
// Each scenario runs in its own transaction and is rolled back.
console.log(
  "\n=== Functional: a presidency transfer keeps member access (20261108200000) ===",
);
{
  const A = "a3670000-0000-4000-8000-00000000000a";
  const B = "b3670000-0000-4000-8000-00000000000b";
  const PRES_A = "a3670000-0000-4000-8000-0000000000a1";
  const MEMBER_A = "a3670000-0000-4000-8000-0000000000a2";
  const CABINET_A = "a3670000-0000-4000-8000-0000000000a3";
  const TREAS_A = "a3670000-0000-4000-8000-0000000000a4";
  const PRES_B = "b3670000-0000-4000-8000-0000000000b1";
  const MEMBER_B = "b3670000-0000-4000-8000-0000000000b2";
  const CUSTOM_VIEW_A = "c3670000-0000-4000-8000-0000000000c1";
  const CUSTOM_VIEW_B = "c3670000-0000-4000-8000-0000000000c2";
  const LEGACY_WILD_A = "a3670000-0000-4000-8000-0000000000a5";
  const OUT = "e3670000-0000-4000-8000-000000000001";
  const IN = "e3670000-0000-4000-8000-000000000002";
  const U_OUT = "f3670000-0000-4000-8000-000000000001";
  const U_IN = "f3670000-0000-4000-8000-000000000002";

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rolesOf = async (memberId) =>
    (await db.query(`select role_ids from members where id = $1`, [memberId]))
      .rows[0]?.role_ids;

  /**
   * Seed two chapters, put the outgoing President in `chapter` holding
   * `outRoles` (and `outCustom`), transfer to a plain member, and return the
   * RPC's rows and both members' roles after it. Rolled back afterwards.
   */
  async function scenario({
    chapter = A,
    presidentRole = PRES_A,
    outRoles,
    outCustom = [],
    dropMemberRole = false,
    memberWithoutView = false,
  }) {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${A}', 'A', 'U'), ('${B}', 'B', 'U');
      insert into roles (id, chapter_id, name, permissions, is_system, system_key, display_order) values
        ('${PRES_A}', '${A}', 'President', '{*}', true, 'PRESIDENT', 1),
        ('${TREAS_A}', '${A}', 'Treasurer', '{billing:view,members:view}', true, 'TREASURER', 2),
        ('${MEMBER_A}', '${A}', 'Member', '{members:view,polls:create}', true, 'MEMBER', 5),
        ('${CABINET_A}', '${A}', 'Cabinet', '{channels:read:cabinet}', false, null, 21),
        ('${LEGACY_WILD_A}', '${A}', 'Legacy', '{*}', false, null, 22),
        ('${PRES_B}', '${B}', 'President', '{*}', true, 'PRESIDENT', 1),
        ('${MEMBER_B}', '${B}', 'Member', '{members:view}', true, 'MEMBER', 5);
      insert into chapter_custom_roles (id, chapter_id, key, label, capabilities) values
        ('${CUSTOM_VIEW_A}', '${A}', 'rush', 'Rush', '{members:view}'),
        ('${CUSTOM_VIEW_B}', '${B}', 'rush', 'Rush', '{members:view}');
      insert into users (id, supabase_auth_id, email) values
        ('${U_OUT}', gen_random_uuid(), 'out@x.test'),
        ('${U_IN}', gen_random_uuid(), 'in@x.test');
      insert into members (id, user_id, chapter_id, role_ids, custom_role_ids) values
        ('${OUT}', '${U_OUT}', '${chapter}', '{${outRoles.join(",")}}', '{${outCustom.join(",")}}'),
        ('${IN}', '${U_IN}', '${chapter}', '{${chapter === A ? MEMBER_A : MEMBER_B}}', '{}');
    `);
    if (memberWithoutView) {
      await db.exec(
        `update roles set permissions = '{polls:create}' where id = '${MEMBER_A}';`,
      );
    }
    if (dropMemberRole) {
      await db.exec(
        `update roles set system_key = null where chapter_id = '${chapter}' and system_key = 'MEMBER';`,
      );
    }
    try {
      const rpc = await db.query(
        `select id, role_ids from transfer_presidency($1, $2, $3, $4)`,
        [chapter, OUT, IN, presidentRole],
      );
      return {
        rows: rpc.rows,
        out: await rolesOf(OUT),
        in: await rolesOf(IN),
      };
    } finally {
      await db.exec("rollback;").catch(() => {});
    }
  }

  try {
    let r = await scenario({ outRoles: [PRES_A] });
    check(
      "a founder holding only President is left with Member",
      same(r.out, [MEMBER_A]) && same(r.in, [MEMBER_A, PRES_A]),
      r,
    );
    check(
      "the RPC returns the outgoing row as it ends up",
      same(r.rows.find((row) => row.id === OUT)?.role_ids, [MEMBER_A]),
      r.rows,
    );

    r = await scenario({ outRoles: [PRES_A, CABINET_A] });
    check(
      "President + a role without members:view → that role, then Member",
      same(r.out, [CABINET_A, MEMBER_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A, TREAS_A] });
    check(
      "President + Treasurer keeps Treasurer alone",
      same(r.out, [TREAS_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A], outCustom: [CUSTOM_VIEW_A] });
    check(
      "a leftover custom role id no longer counts as access (#4075)",
      same(r.out, [MEMBER_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A, LEGACY_WILD_A] });
    check(
      "a legacy live role carrying * counts as access",
      same(r.out, [LEGACY_WILD_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A], outCustom: [CUSTOM_VIEW_B] });
    check(
      "another chapter's custom role doesn't count as access",
      same(r.out, [MEMBER_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A, TREAS_A.toUpperCase()] });
    check(
      "an upper-case role id still counts as access",
      same(r.out, [TREAS_A.toUpperCase()]),
      r,
    );

    r = await scenario({
      outRoles: [PRES_A, MEMBER_A],
      memberWithoutView: true,
    });
    check(
      "Member is not appended twice when it lost members:view",
      same(r.out, [MEMBER_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A, MEMBER_B] });
    check(
      "another chapter's Member id doesn't count as access",
      same(r.out, [MEMBER_B, MEMBER_A]),
      r,
    );

    r = await scenario({ outRoles: [PRES_A], dropMemberRole: true });
    check(
      "a chapter with no Member role still transfers",
      same(r.out, []) && same(r.in, [MEMBER_A, PRES_A]),
      r,
    );

    r = await scenario({ outRoles: [MEMBER_A] });
    check(
      "a member not holding President changes nothing and gets no rows",
      r.rows.length === 0 && same(r.out, [MEMBER_A]) && same(r.in, [MEMBER_A]),
      r,
    );
  } catch (e) {
    check(
      "transfer keeps member access scenario ran",
      false,
      String(e?.message ?? e).split("\n")[0],
    );
  }

  for (const res of results) {
    if (res.ok) {
      console.log(`OK    ${res.name}`);
    } else {
      miss();
      console.log(`MISS  ${res.name}\n        ↳ ${JSON.stringify(res.detail)}`);
    }
  }
}
