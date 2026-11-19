import { db, runAssertions } from "../harness.mjs";

// ─── Client table grants (20261119210325) ───────────────────────────────────
//
// Supabase grants `anon` and `authenticated` every privilege on every public
// table by default, which left row-level security as the only barrier between
// a client key and a table. The apps read just two tables directly
// (`chat_messages`, and `chat_message_actions` for reactions, votes and their
// Realtime echo) and delete only their own reaction rows; every other read and
// write goes through the API as service_role. So the grants are now exactly
// that, and these assertions hold them there: a later migration that grants a
// client role more, or a new table that starts open, fails here.
//
// A table the apps need to read directly is a deliberate change: grant it in
// its migration, add it to CLIENT_TABLE_GRANTS below, and give it a policy the
// black-box tiers read back.

const CLIENT_TABLE_GRANTS = {
  authenticated: {
    "public.chat_messages": ["SELECT"],
    "public.chat_message_actions": ["DELETE", "SELECT"],
  },
  anon: {},
};

const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

// Every (role, relation, privilege) a client role holds on a public table,
// view or sequence, through any path (a direct grant, PUBLIC, or a role it
// inherits), as `has_*_privilege` resolves it. A grant on some columns only
// (`grant select (id, email) on users to anon`) opens those columns without a
// table privilege, so it is listed too, as "<privilege> (columns)".
const HELD_SQL = (role) => `
  select c.oid::regclass::text as rel, p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array[${TABLE_PRIVILEGES.map((p) => `'${p}'`).join(", ")}]) as p(priv)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege('${role}', c.oid, p.priv)
  union all
  select c.oid::regclass::text, p.priv || ' (columns)'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(priv)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_any_column_privilege('${role}', c.oid, p.priv)
     and not has_table_privilege('${role}', c.oid, p.priv)
  union all
  select c.oid::regclass::text, p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(priv)
   where n.nspname = 'public'
     and c.relkind = 'S'
     and has_sequence_privilege('${role}', c.oid, p.priv)
   order by 1, 2`;

function heldMatches(role) {
  return (rows) => {
    const held = {};
    for (const { rel, priv } of rows) {
      const name = rel.startsWith("public.") ? rel : `public.${rel}`;
      (held[name] ??= []).push(priv);
    }
    for (const list of Object.values(held)) list.sort();
    const want = CLIENT_TABLE_GRANTS[role];
    const names = new Set([...Object.keys(held), ...Object.keys(want)]);
    const wrong = [...names].filter(
      (name) =>
        JSON.stringify(held[name] ?? []) !== JSON.stringify(want[name] ?? []),
    );
    if (wrong.length > 0) {
      console.log(
        `        ↳ ${role} holds: ${wrong
          .slice(0, 10)
          .map((name) => `${name} [${(held[name] ?? []).join(", ")}]`)
          .join("; ")}`,
      );
    }
    return wrong.length === 0;
  };
}

// Made before the assertions (a query runs one statement) and dropped after,
// so no later tier sees them. The two whole-schema checks below hold for them
// too: they carry no client grant.
await db.exec(`
  create table public.client_grants_default_probe (id int);
  create sequence public.client_grants_default_probe_seq;
`);

await runAssertions("Client table grants (anon and authenticated)", [
  {
    name: "anon holds no privilege on any public table, view or sequence",
    sql: HELD_SQL("anon"),
    ok: heldMatches("anon"),
  },
  {
    name: "authenticated holds exactly SELECT on chat_messages and SELECT, DELETE on chat_message_actions",
    sql: HELD_SQL("authenticated"),
    ok: heldMatches("authenticated"),
  },
  {
    // A table a later migration creates, as the migration role, starts with no
    // client grant: the default privileges were revoked, not just the grants
    // on the tables that existed then.
    name: "a table created after the migrations starts with no anon or authenticated grant",
    sql: `
      select r.rolname,
             has_any_column_privilege(r.oid, 'public.client_grants_default_probe', 'select')
               or has_any_column_privilege(r.oid, 'public.client_grants_default_probe', 'insert')
               or has_any_column_privilege(r.oid, 'public.client_grants_default_probe', 'update')
               or has_table_privilege(r.oid, 'public.client_grants_default_probe', 'delete') as table_open,
             has_sequence_privilege(r.oid, 'public.client_grants_default_probe_seq', 'usage') as seq_open
        from pg_roles r
       where r.rolname in ('anon', 'authenticated')
    `,
    ok: (rows) => rows.length === 2 && rows.every((r) => !r.table_open && !r.seq_open),
  },
]);

await db.exec(`
  drop table if exists public.client_grants_default_probe;
  drop sequence if exists public.client_grants_default_probe_seq;
`);
