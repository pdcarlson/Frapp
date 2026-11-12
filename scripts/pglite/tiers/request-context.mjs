import { db, miss } from "../harness.mjs";

// ─── Functional: get_request_context (20261112140000, #3583) ────────────────
//
// The chapter guards' prefetch reads the caller's user id, the chapter's
// subscription state, the caller's membership and its roles in this one call,
// and hands each part to the code that would have read it through PostgREST.
// So each part must be exactly that read's answer:
//
//   - `member` is the whole `members` row (`select *`), `user` is `{id}`,
//     `chapter` is the three columns `ChapterGuard` selects;
//   - `roles` holds only roles named in `role_ids` AND in the requested
//     chapter: an id from another chapter left on the row drops out, as the
//     guard's `.eq('chapter_id', …)` drops it;
//   - a user with no membership in the chapter gets `member` null and no
//     roles, and an unknown auth id gets `user` null too;
//   - nobody but `service_role` may call it.
//
// The rows are deleted at the end.
console.log("\n=== Functional: get_request_context (20261112140000) ===");
try {
  const CH = "c3583000-0000-4000-8000-00000000000a";
  const OTHER = "c3583000-0000-4000-8000-00000000000b";
  const U = {
    member: "e3583000-0000-4000-8000-00000000000a",
    outsider: "e3583000-0000-4000-8000-00000000000b",
  };
  const AUTH = {
    member: "f3583000-0000-4000-8000-00000000000a",
    outsider: "f3583000-0000-4000-8000-00000000000b",
    unknown: "f3583000-0000-4000-8000-0000000000ff",
  };
  const R = {
    officer: "a3583000-0000-4000-8000-0000000000a1",
    brother: "a3583000-0000-4000-8000-0000000000a2",
    unheld: "a3583000-0000-4000-8000-0000000000a3",
    elsewhere: "a3583000-0000-4000-8000-0000000000b1",
  };
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Request context', 'U'),
      ('${OTHER}', 'Elsewhere', 'U');
    update chapters set enabled_modules = '{"points": false}'::jsonb where id = '${CH}';
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.member}', '${AUTH.member}', 'rc-member@example.com', 'Member'),
      ('${U.outsider}', '${AUTH.outsider}', 'rc-outsider@example.com', 'Outsider');
    insert into roles (id, chapter_id, name, permissions) values
      ('${R.officer}', '${CH}', 'Officer', '{members:view,events:manage}'),
      ('${R.brother}', '${CH}', 'Brother', '{members:view}'),
      ('${R.unheld}', '${CH}', 'Unheld', '{*}'),
      ('${R.elsewhere}', '${OTHER}', 'Elsewhere', '{*}');
    -- Upper case on purpose: PostgREST's .in() matches a uuid in any case.
    insert into members (user_id, chapter_id, role_ids) values
      ('${U.member}', '${CH}', array['${R.officer.toUpperCase()}', '${R.brother}', '${R.elsewhere}']);
  `);

  const call = async (auth) =>
    (
      await db.query(`select public.get_request_context($1, $2) as ctx`, [
        auth,
        CH,
      ])
    ).rows[0].ctx;

  const member = await call(AUTH.member);
  const outsider = await call(AUTH.outsider);
  const unknown = await call(AUTH.unknown);
  const memberRow = (
    await db.query(
      `select to_jsonb(m) as row from members m where user_id = $1 and chapter_id = $2`,
      [U.member, CH],
    )
  ).rows[0].row;
  const chapterRow = (
    await db.query(
      `select jsonb_build_object('subscription_status', subscription_status,
                                 'past_due_since', past_due_since,
                                 'enabled_modules', enabled_modules) as row
         from chapters where id = $1`,
      [CH],
    )
  ).rows[0].row;
  const roleIds = (ctx) =>
    (ctx?.roles ?? [])
      .map((r) => r.id)
      .sort()
      .join(",");
  const privileges = (
    await db.query(
      `select r.rolname,
              has_function_privilege(r.rolname, 'public.get_request_context(uuid, uuid)', 'execute') as allowed
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'service_role')
        order by r.rolname`,
    )
  ).rows;

  const SCENARIOS = [
    {
      name: "a member gets their user id, the chapter's three columns and their whole membership row",
      got: JSON.stringify([member?.user, member?.chapter, member?.member]),
      want: JSON.stringify([{ id: U.member }, chapterRow, memberRow]),
    },
    {
      name: "roles are those named on the row and in this chapter, whatever their case; another chapter's drops out",
      got: roleIds(member),
      want: [R.brother, R.officer].sort().join(","),
    },
    {
      name: "a role comes back whole, permissions included",
      got: JSON.stringify(
        member?.roles?.find((r) => r.id === R.officer)?.permissions,
      ),
      want: JSON.stringify(["members:view", "events:manage"]),
    },
    {
      name: "a user with no membership here gets no member and no roles",
      got: JSON.stringify([outsider?.user, outsider?.member, outsider?.roles]),
      want: JSON.stringify([{ id: U.outsider }, null, []]),
    },
    {
      name: "an unknown auth id gets no user, member or roles, and still the chapter",
      got: JSON.stringify([
        unknown?.user,
        unknown?.member,
        unknown?.roles,
        unknown?.chapter,
      ]),
      want: JSON.stringify([null, null, [], chapterRow]),
    },
    {
      name: "only service_role may call it",
      got: privileges
        .filter((p) => p.allowed)
        .map((p) => p.rolname)
        .join(","),
      want: privileges.some((p) => p.rolname === "service_role")
        ? "service_role"
        : "",
    },
  ];
  for (const s of SCENARIOS) {
    if (s.got === s.want) {
      console.log(`OK    ${s.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${s.name}\n        ↳ expected ${s.want}, got ${s.got}`,
      );
    }
  }

  await db.exec(`
    delete from members where chapter_id = '${CH}';
    delete from roles where chapter_id in ('${CH}', '${OTHER}');
    delete from chapters where id in ('${CH}', '${OTHER}');
    delete from users where id in ('${U.member}', '${U.outsider}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  get_request_context (#3583)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
