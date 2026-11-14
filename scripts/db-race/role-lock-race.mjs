#!/usr/bin/env node

// Role delete vs member-roles save, under real concurrency (#4862).
//
// `set_member_role_ids` (20261113184311, #4830) key-share locks the roles a
// save names before it locks the member row, the order `delete_role`
// (20261113164050) takes its locks, so a save can't write back a role a
// concurrent delete took away. The PGlite tier
// (`scripts/pglite/tiers/set-member-role-ids.mjs`) is one connection: it plays
// each end state in order and checks the lock order as text. This harness
// opens real connections and overlaps the two for real: one side runs inside
// an open transaction, the other is called meanwhile and must wait on it
// (seen in `pg_blocking_pids`, not guessed from a sleep), and once the first
// commits, the end state is checked. A call that didn't wait, an error, or a
// lock wait past `lock_timeout` fails the case.
//
// What this does not test is deadlock. The held side has taken every lock it
// will take before the other side starts, so the two never wait on each other
// and a deadlock can't arise here: a `set_member_role_ids` that locked the
// member row before the roles (an order that can deadlock against
// `delete_role`) passes all four cases. The lock order itself is guarded by
// the PGlite tier, which checks it in the function's source.
//
// Cases (the issue's three, the third in both orders):
//   1. delete held, save gives the role to a member who lacks it: the save
//      waits, then writes nothing; the member never holds the role.
//   2. save held having given the role, delete called: the delete waits, then
//      strips it and gives Everyone, since nothing else grants access.
//   3a. delete held, save keeps the role for a member who holds it: the save
//      waits, then writes nothing (the delete moved the row).
//   3b. save held keeping the role, delete called: the delete waits, then
//      strips it from the row the save wrote.
//
// Then case 1 again against a copy of `set_member_role_ids` with its
// `for key share` removed, which must fail: the check that this harness can
// still see the race it exists for.
//
// Run it against a database with every migration applied:
//   npm run check:role-lock-race                    local Supabase (default URL)
//   npm run check:role-lock-race -- --apply-migrations
//                                                   a bare Postgres: applies
//                                                   `supabase/migrations/` first
// `DATABASE_URL` picks the database. CI runs the second form against a
// Postgres service container in the `pglite-migrations` job.
//
// Fixtures are committed (the point is two transactions), each case in its own
// chapter, and deleted at the end.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  AUTH_STUBS_SQL,
  DEFAULT_PRIVILEGES_SQL,
  SUPABASE_ROLES_SQL,
} from "../pglite/bootstrap.mjs";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const APPLY = process.argv.includes("--apply-migrations");
// How long a call has to show up as waiting on the held transaction.
const BLOCK_WAIT_MS = 5_000;

const connect = async () => {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  // A lock wait this long is a hang, not a slow machine.
  await c.query(`set lock_timeout = '10s'; set statement_timeout = '20s'`);
  return c;
};

const admin = await connect();
const failures = [];

async function applyMigrations() {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  await admin.query(
    AUTH_STUBS_SQL + SUPABASE_ROLES_SQL + DEFAULT_PRIVILEGES_SQL,
  );
  const start = performance.now();
  for (const f of files) {
    try {
      await admin.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${e.message}`);
    }
  }
  console.log(
    `Applied ${files.length} migrations in ${Math.round(performance.now() - start)}ms`,
  );
}

const chapters = [];

/**
 * A chapter with Everyone (MEMBER, members:view), Chair (members:view),
 * Photographer (no access) and the role under test, plus one member holding
 * `holds` (role names). Returns the ids.
 */
async function seed(holds) {
  const chapter = randomUUID();
  const user = randomUUID();
  const role = {
    everyone: randomUUID(),
    chair: randomUUID(),
    photo: randomUUID(),
    target: randomUUID(),
  };
  chapters.push(chapter);
  await admin.query(
    `insert into chapters (id, name, university) values ($1, 'Race 4862', 'U')`,
    [chapter],
  );
  await admin.query(
    `insert into users (id, supabase_auth_id, email) values ($1, gen_random_uuid(), $2)`,
    [user, `race-4862-${user}@x.test`],
  );
  await admin.query(
    `insert into roles (id, chapter_id, name, system_key, is_system, display_order, permissions) values
       ($2, $1, 'Everyone', 'MEMBER', true, 5, '{members:view}'),
       ($3, $1, 'Chair', null, false, 2, '{members:view}'),
       ($4, $1, 'Photographer', null, false, 7, '{}'),
       ($5, $1, 'Target', null, false, 8, '{}')`,
    [chapter, role.everyone, role.chair, role.photo, role.target],
  );
  const held = holds.map((name) => role[name]);
  const {
    rows: [{ id: member }],
  } = await admin.query(
    `insert into members (chapter_id, user_id, role_ids) values ($1, $2, $3) returning id::text`,
    [chapter, user, held],
  );
  return { chapter, member, role, held };
}

const roleIdsOf = async (member) =>
  (
    await admin.query(
      `select role_ids::text[] as ids from members where id = $1`,
      [member],
    )
  ).rows[0].ids;

const roleExists = async (id) =>
  (await admin.query(`select 1 from roles where id = $1`, [id])).rowCount > 0;

const pidOf = async (c) =>
  (await c.query(`select pg_backend_pid() as pid`)).rows[0].pid;

/**
 * Resolves true once `waiterPid` is blocked by `holderPid`, false if `call`
 * settles first (it didn't wait) or the wait never shows within
 * BLOCK_WAIT_MS.
 */
async function waitsOn(waiterPid, holderPid, call) {
  let settled = false;
  call.then(
    () => (settled = true),
    () => (settled = true),
  );
  const deadline = Date.now() + BLOCK_WAIT_MS;
  while (Date.now() < deadline) {
    const { rows } = await admin.query(
      `select $2::int = any(pg_blocking_pids($1)) as blocked`,
      [waiterPid, holderPid],
    );
    if (rows[0].blocked) return true;
    if (settled) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

const save = (c, fn, s, expected, next) =>
  c.query(
    `select id::text, role_ids::text[] as ids from ${fn}($1, $2, $3::text[], $4::text[])`,
    [s.chapter, s.member, expected, next],
  );
const del = (c, s) =>
  c.query(`select delete_role($1, $2) as result`, [s.chapter, s.role.target]);

/**
 * Hold `first` open in a transaction on one connection, start `second` on
 * another, check it waits, commit, and hand both results to `verify`, which
 * returns a list of problems.
 */
const DID_NOT_WAIT = "the second call did not wait on the held transaction";

async function overlap(
  name,
  first,
  second,
  verify,
  { expectFail = false } = {},
) {
  const holder = await connect();
  const waiter = await connect();
  const problems = [];
  try {
    const [holderPid, waiterPid] = [await pidOf(holder), await pidOf(waiter)];
    await holder.query("begin");
    const held = await first(holder);
    const call = second(waiter);
    // Attach the handler now, so a rejection while we poll isn't unhandled.
    const outcome = call.then(
      (r) => ({ r }),
      (e) => ({ e }),
    );
    if (!(await waitsOn(waiterPid, holderPid, call))) {
      problems.push(DID_NOT_WAIT);
    }
    await holder.query("commit");
    const { r, e } = await outcome;
    if (e)
      problems.push(`the second call failed: ${e.code ?? ""} ${e.message}`);
    else problems.push(...(await verify(held, r)));
  } catch (e) {
    problems.push(`${e.code ?? ""} ${e.message}`);
    await holder.query("rollback").catch(() => {});
  } finally {
    await holder.end();
    await waiter.end();
  }
  const tag = problems.length ? (expectFail ? "red " : "FAIL") : "OK  ";
  console.log(`${tag}  ${name}`);
  for (const p of problems) console.log(`        ↳ ${p}`);
  return problems;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const expect = (problems, ok, msg) => {
  if (!ok) problems.push(msg);
};

async function case1(fn = "set_member_role_ids") {
  const mutant = fn !== "set_member_role_ids";
  const s = await seed(["everyone"]);
  return overlap(
    `1. delete held; save giving the role waits, then writes nothing${mutant ? ` (${fn}, expected red)` : ""}`,
    (c) => del(c, s),
    (c) => save(c, fn, s, s.held, [...s.held, s.role.target]),
    async (_held, saved) => {
      const p = [];
      expect(
        p,
        saved.rowCount === 0,
        `save wrote ${JSON.stringify(saved.rows)}`,
      );
      const ids = await roleIdsOf(s.member);
      expect(
        p,
        same(ids, [s.role.everyone]),
        `member holds ${JSON.stringify(ids)}`,
      );
      expect(p, !(await roleExists(s.role.target)), "the role still exists");
      return p;
    },
    { expectFail: mutant },
  );
}

async function case2() {
  const s = await seed(["chair"]);
  return overlap(
    "2. save giving the role held; delete waits, then strips it and gives Everyone",
    (c) => save(c, "set_member_role_ids", s, s.held, [s.role.target]),
    (c) => del(c, s),
    async (saved, deleted) => {
      const p = [];
      expect(p, saved.rowCount === 1, "the held save wrote nothing");
      const result = deleted.rows[0].result;
      expect(
        p,
        same(result?.stripped_member_ids, [s.member]) &&
          same(result?.given_everyone_member_ids, [s.member]),
        `delete returned ${JSON.stringify(result)}`,
      );
      const ids = await roleIdsOf(s.member);
      expect(
        p,
        same(ids, [s.role.everyone]),
        `member holds ${JSON.stringify(ids)}`,
      );
      return p;
    },
  );
}

async function case3a() {
  const s = await seed(["target", "chair"]);
  return overlap(
    "3a. delete held; save keeping the role waits, then writes nothing",
    (c) => del(c, s),
    (c) => save(c, "set_member_role_ids", s, s.held, [...s.held, s.role.photo]),
    async (_held, saved) => {
      const p = [];
      expect(
        p,
        saved.rowCount === 0,
        `save wrote ${JSON.stringify(saved.rows)}`,
      );
      const ids = await roleIdsOf(s.member);
      expect(
        p,
        same(ids, [s.role.chair]),
        `member holds ${JSON.stringify(ids)}`,
      );
      return p;
    },
  );
}

async function case3b() {
  const s = await seed(["target"]);
  return overlap(
    "3b. save keeping the role held; delete waits, then strips it from the saved row",
    (c) => save(c, "set_member_role_ids", s, s.held, [...s.held, s.role.photo]),
    (c) => del(c, s),
    async (saved, deleted) => {
      const p = [];
      expect(p, saved.rowCount === 1, "the held save wrote nothing");
      const result = deleted.rows[0].result;
      expect(
        p,
        same(result?.stripped_member_ids, [s.member]),
        `delete returned ${JSON.stringify(result)}`,
      );
      const ids = await roleIdsOf(s.member);
      expect(
        p,
        same(ids, [s.role.photo, s.role.everyone]),
        `member holds ${JSON.stringify(ids)}`,
      );
      return p;
    },
  );
}

/**
 * `set_member_role_ids` as deployed, minus its `for key share`, created as
 * `public.set_member_role_ids_no_role_lock` for the sensitivity check and
 * dropped after.
 */
async function createMutant() {
  const {
    rows: [{ def }],
  } = await admin.query(
    `select pg_get_functiondef('public.set_member_role_ids(uuid, uuid, text[], text[])'::regprocedure) as def`,
  );
  const mutant = def
    .replace(
      "public.set_member_role_ids(",
      "public.set_member_role_ids_no_role_lock(",
    )
    .replace(/\s+for key share;/i, ";");
  if (mutant === def || /for key share/i.test(mutant)) {
    throw new Error(
      "could not strip `for key share` from set_member_role_ids; update the sensitivity check",
    );
  }
  await admin.query(mutant);
}

try {
  if (APPLY) await applyMigrations();
  console.log(
    "\n=== Role delete vs member-roles save, two connections (#4862) ===",
  );
  failures.push(...(await case1()));
  failures.push(...(await case2()));
  failures.push(...(await case3a()));
  failures.push(...(await case3b()));

  console.log("\n=== Sensitivity: case 1 without the role lock must fail ===");
  await createMutant();
  try {
    const mutantProblems = await case1("set_member_role_ids_no_role_lock");
    // Red for the reason it exists: the save went ahead instead of waiting.
    // Any other problem (an error, a timeout) proves nothing about the lock.
    if (!mutantProblems.includes(DID_NOT_WAIT)) {
      failures.push(
        "case 1 without `for key share` did not fail by not waiting: it can't be shown to see the race",
      );
      console.log("FAIL  case 1 did not notice the role lock was gone");
    } else {
      console.log("OK    case 1 goes red without the role lock, as it must");
    }
  } finally {
    await admin.query(
      `drop function if exists public.set_member_role_ids_no_role_lock(uuid, uuid, text[], text[])`,
    );
  }
} catch (e) {
  failures.push(String(e?.message ?? e));
  console.error(`ERROR ${e?.message ?? e}`);
} finally {
  if (chapters.length) {
    await admin
      .query(`delete from chapters where id = any($1::uuid[])`, [chapters])
      .catch((e) => console.error(`cleanup: ${e.message}`));
    await admin
      .query(`delete from users where email like 'race-4862-%@x.test'`)
      .catch((e) => console.error(`cleanup: ${e.message}`));
  }
  await admin.end();
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} problem(s).`);
  process.exit(1);
}
console.log(
  "\nOK — every overlap waited and ended right, and the save without its role lock went red.",
);
