import { db, miss, runAssertions, runOne } from "../harness.mjs";
import { LANDMARKS } from "../landmarks.mjs";
import { RLS_EXEMPT_TABLES, RLS_SMOKE } from "../rls-smoke.mjs";

await runAssertions("Schema landmarks", LANDMARKS);

// Default-deny invariant (#360): every base table in `public` must enable RLS.
// Catalog-driven, so it covers CREATE TABLE IF NOT EXISTS / quoted / schema-
// qualified forms for free — it inspects the applied schema, not the SQL text.
console.log("\n=== RLS smoke ===");
{
  const res = await db.query(
    `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
      order by c.relname`,
  );
  const offenders = res.rows
    .map((r) => r.relname)
    .filter((t) => !RLS_EXEMPT_TABLES.has(t));
  if (offenders.length === 0) {
    console.log("OK    every public table enables RLS (default-deny invariant)");
  } else {
    miss();
    console.log(
      `MISS  ${offenders.length} public table(s) without RLS enabled\n        ↳ ${offenders.join(", ")}`,
    );
  }
}
for (const lm of RLS_SMOKE) await runOne(lm);
