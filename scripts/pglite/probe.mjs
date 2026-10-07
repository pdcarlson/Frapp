import { db, miss } from "./harness.mjs";

// ─── Who a tier reads as (#1556) ────────────────────────────────────────────
//
// A reader is three things, and a scenario that sets only one of them is a
// different reader from the one its name claims:
//   - `uid`: what `auth.uid()` returns, the JWT's `sub`; null with no JWT.
//   - `jwtRole`: what `auth.role()` returns, the JWT's `role` claim.
//   - `dbRole`: the Postgres role the read runs as, which is what a policy's
//     `TO` clause binds. RLS skips superusers and table owners, so a
//     black-box read needs a non-owner probe role at all.
//
// Every reader is built here, and setAuth() stubs both auth functions for it,
// so no scenario inherits the previous one's role. There are three null-uid
// readers because each binds a different set of policies, and none of them
// covers what the other two do.
export const signedIn = (uid) => ({ uid, jwtRole: "authenticated", dbRole: "rls_probe" });

// A signed-in session with no `sub`. GoTrue never mints one, so hosted never
// receives this request. It is the chat tiers' "no JWT" reader because it is
// the only one that reaches a null-uid branch behind an `auth.role() =
// 'authenticated'` conjunct, which both chat policies carry. So a predicate
// spelled `... and (can_read_chat_message(id) or auth.uid() is null)` leaks
// every row to this reader and to neither of the two below. (ANON_CLAIM
// reaches a null-uid branch too, in a `to authenticated` policy that does not
// test the role.)
export const NULL_SUB = { uid: null, jwtRole: "authenticated", dbRole: "rls_probe" };

// The anon claim, read through the `authenticated` grant: the deny tier's
// anonymous reader (#423). With `auth.role()` left at 'authenticated' it would
// be NULL_SUB under another name, and a policy spelled `using (auth.role() =
// 'anon')` would read as default-deny.
export const ANON_CLAIM = { uid: null, jwtRole: "anon", dbRole: "rls_probe" };

// The anon key as hosted runs it (#1557 created the role): no uid, the anon
// claim, and the read made as a member of `anon` and not of `authenticated`.
// It is the only reader a policy spelled `to anon` binds, since the two above
// hold the `authenticated` grant instead. Every black-box table is read as it:
// both chat matrices, the post-archive re-check and the default-deny tier.
export const ANON_KEY = { uid: null, jwtRole: "anon", dbRole: "rls_probe_anon" };

const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

// Point `auth.uid()` and `auth.role()` at a reader. Both, always: this is the
// one place either stub is rewritten per scenario.
export async function setAuth({ uid, jwtRole }) {
  // A mistyped `F.` key yields undefined, which would interpolate
  // 'undefined'::uuid and read as a denial: a scenario that silently tests
  // nothing. Fail loudly instead.
  if (uid !== null && typeof uid !== "string") {
    throw new Error(`a reader has a non-fixture uid (${String(uid)})`);
  }
  const sub = uid === null ? "null" : `'${uid}'`;
  await db.exec(`
    create or replace function auth.uid()  returns uuid language sql as $$ select ${sub}::uuid $$;
    create or replace function auth.role() returns text language sql as $$ select '${jwtRole}'::text $$;
  `);
}

// One black-box read as `who`, in its own savepoint. Returns `{ rows, failure }`
// and does not throw: a bad reader (a non-fixture uid) comes back as that
// scenario's failure too, so the verdict names the scenario to fix.
//
// The savepoint is the point (#1556). A policy that references a table the
// probe cannot read raises `permission denied` instead of returning rows, and
// an error inside the open transaction poisons it (25P02) for everything after.
// Before this helper, one such policy in the first tier unwound to the
// tier-wide catch, and every later tier never ran: the log showed one chat
// error and no deny header at all. Rolling back to the savepoint keeps the
// transaction usable, so each scenario reports its own verdict and the tiers
// after it still run.
export async function probeAs(who, sql) {
  try {
    await setAuth(who);
  } catch (e) {
    return { rows: null, failure: firstLine(e) };
  }
  await db.exec("savepoint probe;");
  let rows = null;
  let failure = null;
  try {
    await db.exec(`set role ${who.dbRole};`);
    rows = (await db.query(sql)).rows;
  } catch (e) {
    failure = firstLine(e);
  } finally {
    try {
      await db.exec("reset role;");
    } catch {
      /* the savepoint rollback below is what actually recovers */
    }
    // Guarded like the `reset role` above, and for the same reason: a throw
    // raised in `finally` REPLACES the verdict the try/catch just computed.
    //
    // `rollback to savepoint` does NOT destroy the savepoint (verified while
    // building the #423 deny tier: rolling back to the same name three times
    // succeeds), so the error branch releases it explicitly. Otherwise every
    // failing read leaves another live subtransaction open.
    try {
      await db.exec(
        failure === null
          ? "release savepoint probe;"
          : "rollback to savepoint probe; release savepoint probe;",
      );
    } catch (e) {
      failure ??= `savepoint cleanup failed: ${firstLine(e)}`;
    }
  }
  return { rows, failure };
}

// The exact-set verdict the visibility tiers print. A count is satisfied by the
// right NUMBER of wrong rows, so each reader's set is compared both ways. Reads
// select their row id as `id`.
export function expectSet(name, probe, visible, labelOf) {
  if (probe.failure !== null) {
    miss();
    console.log(`MISS  ${name}\n        ↳ the read raised instead: ${probe.failure}`);
    return;
  }
  const got = probe.rows.map((r) => r.id).sort();
  const want = [...visible].sort();
  const leaked = got.filter((g) => !want.includes(g));
  const absent = want.filter((w) => !got.includes(w));
  if (leaked.length === 0 && absent.length === 0) {
    console.log(`OK    ${name}`);
  } else {
    miss();
    console.log(
      `MISS  ${name}` +
        (leaked.length ? `\n        ↳ LEAKED: ${leaked.map(labelOf).join(", ")}` : "") +
        (absent.length ? `\n        ↳ wrongly hidden: ${absent.map(labelOf).join(", ")}` : ""),
    );
  }
}

export async function canReadAs(authUid, messageId) {
  await setAuth(authUid === null ? NULL_SUB : signedIn(authUid));
  const res = await db.query(
    `select public.can_read_chat_message('${messageId}'::uuid) as ok`,
  );
  return res.rows[0].ok === true;
}
