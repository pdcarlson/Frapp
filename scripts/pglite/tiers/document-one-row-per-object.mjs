import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, miss } from "../harness.mjs";

console.log(
  "\n=== Functional: one chapter_documents row per stored object (#3399) ===",
);
{
  // `confirmUpload` answers a retried confirm from a read of the path, and
  // the index is what holds when two confirms race past that read: the API's
  // document create turns its 23505 into the row that won. Every unit suite
  // mocks the repository, so this is the CI-run proof that the index exists
  // and that the migration's guard stops on rows it would have to choose
  // between (the live-PostgREST test,
  // apps/api/test/integration/chapter-document-confirm.integration-spec.ts,
  // isn't run in CI).
  const CHAPTER = "a3399000-0000-4000-8000-00000000000a";
  const USER = "a3399000-0000-4000-8000-000000000001";
  const PATH = `chapters/${CHAPTER}/documents/a3399000-0000-4000-8000-0000000000d1/minutes.jpg`;
  const MIGRATION = join(
    process.cwd(),
    "supabase/migrations/20261104210000_chapter_documents_storage_path_key.sql",
  );

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  // Postgres aborts the transaction on an error, so each attempt runs under
  // its own savepoint and is rolled back to it.
  const refused = async (sql) => {
    await db.exec("savepoint p3399;");
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    } finally {
      await db.exec("rollback to savepoint p3399;");
    }
  };
  const file = (path, title) =>
    `insert into chapter_documents (chapter_id, title, storage_path, uploaded_by)
     values ('${CHAPTER}', '${title}', '${path}', '${USER}');`;

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values ('${CHAPTER}', 'A', 'U');
      insert into users (id, supabase_auth_id, email, display_name)
        values ('${USER}', '${USER}', 'docs-3399@example.test', 'Uploader');
      ${file(PATH, "Minutes")}
    `);

    const second = await refused(file(PATH, "Minutes again"));
    const otherPath = await refused(
      file(PATH.replace("minutes", "bylaws"), "Bylaws"),
    );
    check(
      "a second row for a filed storage_path is refused, and another path is not",
      /chapter_documents_storage_path_key/.test(second ?? "") &&
        otherPath === null,
      { second, otherPath },
    );

    // The guard: with the index gone and a path filed twice, re-running the
    // migration stops and changes nothing.
    const guard = await refused(`
      drop index public.chapter_documents_storage_path_key;
      ${file(PATH, "Minutes again")}
      ${readFileSync(MIGRATION, "utf8")}
    `);
    check(
      "the migration stops on a path already filed twice instead of choosing a row",
      /filed more than once/.test(guard ?? ""),
      { guard },
    );
  } catch (e) {
    check(
      "one-row-per-object scenario ran",
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
