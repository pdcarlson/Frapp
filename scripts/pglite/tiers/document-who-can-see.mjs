import { db, miss } from "../harness.mjs";

// ─── Who can see a Documents folder or file (#3642 piece 1) ─────────────────
//
// `rename_document_folder` and `delete_document_folder` are reached from the
// API only through mocked repositories, so this is where their SQL runs. A
// file under a name no folder row claims has no folder list to pass, so each
// must move a restricted folder's files without opening them. What each check
// pins, and the edit it catches:
// - a list holds only tier:, role: and group: entries (the check constraint);
// - a rename re-files the documents and renames the row together;
// - a rename onto a name the chapter uses rolls the documents back too;
// - a delete gives the folder's list to a file on "Same as folder", keeps
//   only shared entries on a file with its own list, moves both to the top
//   level and deletes the row, and touches no other chapter.
try {
  const CH = "c1c1c1c1-0000-4000-8000-000000003642";
  const OTHER = "c1c1c1c1-0000-4000-8000-000000003643";
  const U = "c3c3c3c3-0000-4000-8000-00000000000a";
  const EXEC = "c4c4c4c4-0000-4000-8000-000000000001";
  const OPEN = "c4c4c4c4-0000-4000-8000-000000000002";
  const OTHER_EXEC = "c4c4c4c4-0000-4000-8000-000000000003";
  const TIER = "tier:c6c6c6c6-0000-4000-8000-000000000001";
  const ROLE = "role:c6c6c6c6-0000-4000-8000-000000000002";
  const doc = (n) => `c5c5c5c5-0000-4000-8000-00000000000${n}`;
  await db.exec(`
    insert into chapters (id, name, university) values
      ('${CH}', 'Who can see', 'U'), ('${OTHER}', 'Other', 'U');
    insert into users (id, supabase_auth_id, email, display_name) values
      ('${U}', gen_random_uuid(), 'who-can-see@example.com', 'A');
    insert into chapter_document_folders (id, chapter_id, name, who_can_see) values
      ('${EXEC}', '${CH}', 'Exec', array['${TIER}']),
      ('${OPEN}', '${CH}', 'Open', null),
      ('${OTHER_EXEC}', '${OTHER}', 'Board', array['${TIER}']);
    insert into chapter_documents
      (id, chapter_id, title, folder, storage_path, uploaded_by, who_can_see)
    values
      ('${doc(1)}', '${CH}', 'Minutes', 'Exec', 'chapters/${CH}/documents/1/a.pdf', '${U}', null),
      ('${doc(2)}', '${CH}', 'Budget', 'Exec', 'chapters/${CH}/documents/2/b.pdf', '${U}',
        array['${ROLE}', '${TIER}']),
      ('${doc(3)}', '${OTHER}', 'Theirs', 'Exec', 'chapters/${OTHER}/documents/3/c.pdf', '${U}', null);
  `);

  const rejects = async (sql) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };
  const row = async (sql) => (await db.query(sql)).rows[0];
  const docRow = (n) =>
    row(`select folder, who_can_see from chapter_documents where id = '${doc(n)}'`);
  const checks = [];

  checks.push([
    await rejects(
      `update chapter_documents set who_can_see = array['everyone'] where id = '${doc(1)}';`,
    ),
    "a list entry that isn't tier:, role: or group: is refused",
  ]);

  const renamed = await db.query(
    `select * from public.rename_document_folder('${CH}', '${EXEC}', 'Board')`,
  );
  checks.push([
    renamed.rows.length === 1 &&
      renamed.rows[0].name === "Board" &&
      (await docRow(1)).folder === "Board" &&
      (await docRow(2)).folder === "Board" &&
      (await row(`select folder from chapter_documents where id = '${doc(3)}'`))
        .folder === "Exec",
    "a rename re-files the folder's documents and renames its row together, in its chapter only",
  ]);

  checks.push([
    (await rejects(
      `select public.rename_document_folder('${CH}', '${EXEC}', 'Open');`,
    )) &&
      (await docRow(1)).folder === "Board" &&
      (await row(`select name from chapter_document_folders where id = '${EXEC}'`))
        .name === "Board",
    "a rename onto a name the chapter uses fails and leaves the documents where they were",
  ]);

  checks.push([
    (
      await db.query(
        `select * from public.rename_document_folder('${OTHER}', '${EXEC}', 'X')`,
      )
    ).rows.length === 0,
    "a rename names the folder in its own chapter or nothing",
  ]);

  const deleted = await row(
    `select public.delete_document_folder('${CH}', '${EXEC}') as ok`,
  );
  const minutes = await docRow(1);
  const budget = await docRow(2);
  checks.push([
    deleted.ok === true &&
      minutes.folder === null &&
      JSON.stringify(minutes.who_can_see) === JSON.stringify([TIER]) &&
      budget.folder === null &&
      JSON.stringify(budget.who_can_see) === JSON.stringify([TIER]) &&
      (await row(`select count(*)::int as n from chapter_document_folders where id = '${EXEC}'`))
        .n === 0,
    "deleting a restricted folder keeps its list on its files (shared entries only on a file with its own) and moves them to the top level",
  ]);
  checks.push([
    (await row(`select public.delete_document_folder('${CH}', '${EXEC}') as ok`))
      .ok === false &&
      (await row(`select folder from chapter_documents where id = '${doc(3)}'`))
        .folder === "Exec",
    "deleting a folder that isn't there answers false and touches no other chapter",
  ]);

  console.log("\n=== Who can see a Documents folder or file (#3642) ===");
  for (const [ok, name] of checks) {
    if (ok) {
      console.log(`OK    ${name}`);
    } else {
      miss();
      console.log(`MISS  ${name} (#3642)`);
    }
  }

  await db.exec(`
    delete from chapters where id in ('${CH}', '${OTHER}');
    delete from users where id = '${U}';
  `);
} catch (e) {
  miss();
  console.log(
    `MISS  who can see a Documents folder or file (#3642)\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`,
  );
}
