import { db, miss } from "../harness.mjs";

// ─── Pinned and starred documents and folders (#3934) ───────────────────────
//
// `chapter_document_stars` and the `anonymize_user` purge are reached from the
// API only through mocked repositories, so this is the one place their SQL
// runs. What each check pins, and the edit it catches:
// - a star names exactly one of a folder or a document;
// - a member stars a folder or a document once (the toggle is idempotent);
// - two members may star the same folder, and one member many folders;
// - deleting the folder or the document takes its stars with it;
// - account deletion deletes the member's stars and nobody else's.
try {
  const CH = "b1b1b1b1-0000-4000-8000-000000003934";
  const U = {
    a: "b3b3b3b3-0000-4000-8000-00000000000a",
    b: "b3b3b3b3-0000-4000-8000-00000000000b",
  };
  const F1 = "b4b4b4b4-0000-4000-8000-000000000001";
  const F2 = "b4b4b4b4-0000-4000-8000-000000000002";
  const DOC = "b5b5b5b5-0000-4000-8000-000000000001";
  await db.exec(`
    insert into chapters (id, name, university) values ('${CH}', 'Stars', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U.a}', gen_random_uuid(), 'stars-a@example.com', 'A'),
      ('${U.b}', gen_random_uuid(), 'stars-b@example.com', 'B');
    insert into chapter_document_folders (id, chapter_id, name, pinned_at) values
      ('${F1}', '${CH}', 'Bylaws', now()),
      ('${F2}', '${CH}', 'Rush', null);
    insert into chapter_documents
      (id, chapter_id, title, folder, storage_path, uploaded_by, pinned_at)
    values
      ('${DOC}', '${CH}', 'Constitution', 'Bylaws',
       'chapters/${CH}/documents/x/constitution.pdf', '${U.a}', now());
  `);

  const rejects = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };
  const count = async (where) =>
    (
      await db.query(
        `select count(*)::int as n from chapter_document_stars where ${where}`,
      )
    ).rows[0].n;
  const checks = [];

  checks.push([
    await rejects(
      `insert into chapter_document_stars (user_id, chapter_id) values ('${U.a}', '${CH}');`,
    ),
    "a star with neither a folder nor a document is refused",
  ]);
  checks.push([
    await rejects(
      `insert into chapter_document_stars (user_id, chapter_id, folder_id, document_id)
       values ('${U.a}', '${CH}', '${F1}', '${DOC}');`,
    ),
    "a star naming both a folder and a document is refused",
  ]);

  await db.exec(`
    insert into chapter_document_stars (user_id, chapter_id, folder_id) values
      ('${U.a}', '${CH}', '${F1}'),
      ('${U.a}', '${CH}', '${F2}'),
      ('${U.b}', '${CH}', '${F1}');
    insert into chapter_document_stars (user_id, chapter_id, document_id) values
      ('${U.a}', '${CH}', '${DOC}'),
      ('${U.b}', '${CH}', '${DOC}');
  `);
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 3,
    "one member stars two folders and a document",
  ]);
  checks.push([
    await rejects(
      `insert into chapter_document_stars (user_id, chapter_id, folder_id) values ('${U.a}', '${CH}', '${F1}');`,
    ),
    "a member stars a folder only once",
  ]);
  checks.push([
    await rejects(
      `insert into chapter_document_stars (user_id, chapter_id, document_id) values ('${U.a}', '${CH}', '${DOC}');`,
    ),
    "a member stars a document only once",
  ]);

  await db.exec(`delete from chapter_document_folders where id = '${F2}';`);
  checks.push([
    (await count(`folder_id = '${F2}'`)) === 0 &&
      (await count(`user_id = '${U.a}'`)) === 2,
    "deleting a folder takes its stars with it, and only its",
  ]);
  await db.exec(`delete from chapter_documents where id = '${DOC}';`);
  checks.push([
    (await count(`document_id is not null`)) === 0,
    "deleting a document takes its stars with it",
  ]);

  await db.query(`select public.anonymize_user($1)`, [U.a]);
  checks.push([
    (await count(`user_id = '${U.a}'`)) === 0 &&
      (await count(`user_id = '${U.b}'`)) === 1,
    "account deletion deletes the member's stars and nobody else's",
  ]);

  console.log("\n=== Pinned and starred documents (#3934) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3934)`);
    }
  }

  await db.exec(`
    delete from chapters where id = '${CH}';
    delete from users where id in ('${U.a}', '${U.b}');
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  pinned and starred documents (#3934)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
