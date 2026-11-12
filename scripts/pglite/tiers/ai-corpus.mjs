import { readFileSync } from "node:fs";
import { db, miss } from "../harness.mjs";

// ─── Functional: the AI corpus (20261112140150, #720) ───────────────────────
//
// The index Ask retrieves from. This tier is the proof the spec asks for
// (`spec/architecture/README.md` § 13 Retrieval): one chapter can never
// retrieve another chapter's content. It runs the real SQL, not a stand-in.
//
// Two chapters hold the same sentence, embedded with the same vector, so a
// retrieval that forgot the chapter would return both. It checks:
//
//   ISOLATION
//   - a member of A asking in A gets A's passage and never B's;
//   - a member of A asking in B (a chapter they are not in) gets nothing,
//     although B has a passage that matches exactly;
//   - a member of both A and B asking in B gets B's passage and nothing of
//     A's;
//   - someone in no chapter gets nothing;
//   - called with a member's token, the function answers only for that
//     member, not for whoever p_user_id names;
//   - a passage cannot be written under another chapter than its source's;
//   - neither client role may execute any of the functions.
//
//   RETRIEVAL
//   - a passage found by both halves carries both ranks; an exact word the
//     vector knows nothing about is found by the word half alone;
//   - a source that is not indexed at its current revision is not read, and
//     passages from another embedding model stay out of the nearest list.
//
//   FOLLOWING THE SOURCES
//   - a new document waits to be indexed; a changed one loses its passages
//     at once and waits again; a deleted one is gone, passages included;
//   - draft minutes are not a source, posted minutes are, and editing or
//     deleting them is followed the same way;
//   - a write for an older revision of a source writes nothing;
//   - a source indexed again at the same revision is not read until it is
//     finished; the migration's backfill enrols existing rows;
//   - claiming hands a source out once and pushes its next attempt out; a
//     source indexed under another fingerprint is claimed again.
//
// Everything runs inside one transaction and is rolled back.
console.log("\n=== Functional: the AI corpus (20261112140150, #720) ===");
{
  const CH_A = "a0720000-0000-4000-8000-00000000000a";
  const CH_B = "a0720000-0000-4000-8000-00000000000b";
  const U_A = "a0720000-0000-4000-8000-0000000000a1"; // member of A only
  const U_B = "a0720000-0000-4000-8000-0000000000b1"; // member of B only
  const U_AB = "a0720000-0000-4000-8000-0000000000ab"; // member of both
  const U_NONE = "a0720000-0000-4000-8000-0000000000ff"; // member of neither
  const AUTH_A = "a0720000-0000-4000-8000-0000000a11a1";
  const DOC_A = "a0720000-0000-4000-8000-0000000000d1";
  const DOC_B = "a0720000-0000-4000-8000-0000000000d2";
  const DOC_A2 = "a0720000-0000-4000-8000-0000000000d3";
  const MEET_A = "a0720000-0000-4000-8000-0000000000e1";
  const MODEL = "gemini-embedding-001";
  const FP = `${MODEL}.1536.p1`;

  // A 1,536-wide unit vector along one axis, as pgvector reads it from text.
  const axis = (i) =>
    `[${Array.from({ length: 1536 }, (_, n) => (n === i ? 1 : 0)).join(",")}]`;
  const SAME = axis(0);
  const OTHER = axis(1);

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });
  const rows = async (text, params = []) => (await db.query(text, params)).rows;
  const refused = async (fn) => {
    await db.exec("savepoint expect_refusal");
    try {
      await fn();
      await db.exec("release savepoint expect_refusal");
      return false;
    } catch {
      await db.exec("rollback to savepoint expect_refusal");
      return true;
    }
  };
  const sourceOf = async (type, id) =>
    (
      await rows(
        `select * from corpus_sources where source_type = $1 and source_id = $2`,
        [type, id],
      )
    )[0];
  const chunkCount = async (sourceRowId) =>
    (
      await rows(
        `select count(*)::int as n from corpus_chunks where corpus_source_id = $1`,
        [sourceRowId],
      )
    )[0].n;
  const write = async (sourceRowId, revision, chunks, first = true, model = MODEL) =>
    (
      await rows(
        `select write_corpus_chunks($1, $2, $3, $4, $5::jsonb) as ok`,
        [sourceRowId, revision, first, model, JSON.stringify(chunks)],
      )
    )[0].ok;
  const finish = async (sourceRowId, revision, count, title, skip = null) =>
    (
      await rows(
        `select finish_corpus_source($1, $2, $3, $4, now(), false, $5, $6) as ok`,
        [sourceRowId, revision, FP, title, count, skip],
      )
    )[0].ok;
  const match = (chapter, user, query, embedding = SAME, model = MODEL) =>
    rows(
      `select * from match_corpus_chunks($1, $2, $3, $4, $5, 40)
        order by dense_rank nulls last, sparse_rank nulls last`,
      [chapter, user, query, embedding, model],
    );
  const chunk = (index, content, embedding, heading = null) => ({
    chunk_index: index,
    heading,
    content,
    page_start: null,
    page_end: null,
    embedding,
  });

  try {
    await db.exec(`
      begin;
      insert into chapters (id, name, university) values
        ('${CH_A}', 'Corpus A', 'U'), ('${CH_B}', 'Corpus B', 'U');
      insert into users (id, supabase_auth_id, email) values
        ('${U_A}', '${AUTH_A}', 'corpus-a@test.local'),
        ('${U_B}', gen_random_uuid(), 'corpus-b@test.local'),
        ('${U_AB}', gen_random_uuid(), 'corpus-ab@test.local'),
        ('${U_NONE}', gen_random_uuid(), 'corpus-none@test.local');
      insert into members (user_id, chapter_id) values
        ('${U_A}', '${CH_A}'), ('${U_B}', '${CH_B}'),
        ('${U_AB}', '${CH_A}'), ('${U_AB}', '${CH_B}');
      insert into chapter_documents (id, chapter_id, title, storage_path, uploaded_by) values
        ('${DOC_A}', '${CH_A}', 'Bylaws', 'a/bylaws.pdf', '${U_A}'),
        ('${DOC_B}', '${CH_B}', 'Bylaws', 'b/bylaws.pdf', '${U_B}');
    `);

    // ── Following the sources: a new document waits ──────────────────────
    const srcA = await sourceOf("chapter_document", DOC_A);
    const srcB = await sourceOf("chapter_document", DOC_B);
    check(
      "a new document gets a waiting source row in its own chapter",
      srcA?.status === "pending" &&
        srcA.chapter_id === CH_A &&
        Number(srcA.revision) === 1 &&
        srcA.changed_by === U_A &&
        srcB?.chapter_id === CH_B,
      { srcA, srcB },
    );

    // The same sentence and the same vector in both chapters.
    const SENTENCE = "Semester dues are $225 and are due by September 15.";
    await write(srcA.id, 1, [
      chunk(0, SENTENCE, SAME, "Article IV: Dues"),
      chunk(1, "The quartermaster keeps the ritual equipment.", OTHER),
    ]);
    await write(srcB.id, 1, [chunk(0, SENTENCE, SAME, "Article IV: Dues")]);

    check(
      "passages of a source that is not marked indexed are not retrieved",
      (await match(CH_A, U_A, "dues")).length === 0,
      {},
    );
    await finish(srcA.id, 1, 2, "Bylaws");
    await finish(srcB.id, 1, 1, "Bylaws");

    // ── Isolation ────────────────────────────────────────────────────────
    const aInA = await match(CH_A, U_A, "dues");
    check(
      "a member of A asking in A gets A's passages and none of B's",
      aInA.length === 2 &&
        aInA.every((r) => r.source_id === DOC_A && r.corpus_source_id === srcA.id),
      { aInA: aInA.map((r) => [r.source_id, r.dense_rank, r.sparse_rank]) },
    );
    check(
      "a member of A asking in B gets nothing, though B holds an exact match",
      (await match(CH_B, U_A, "dues")).length === 0,
      {},
    );
    const abInB = await match(CH_B, U_AB, "dues");
    check(
      "a member of both A and B asking in B gets B's passage and nothing of A's",
      abInB.length === 1 && abInB[0].source_id === DOC_B,
      { abInB: abInB.map((r) => r.source_id) },
    );
    check(
      "someone in no chapter gets nothing from either",
      (await match(CH_A, U_NONE, "dues")).length === 0 &&
        (await match(CH_B, U_NONE, "dues")).length === 0,
      {},
    );

    // With a member's token, p_user_id must be that member.
    await db.exec(
      `create or replace function auth.uid() returns uuid language sql as $$ select '${AUTH_A}'::uuid $$;`,
    );
    const asSelf = await match(CH_A, U_A, "dues");
    const asOther = await match(CH_B, U_B, "dues");
    await db.exec(
      `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`,
    );
    check(
      "under a member's token the function answers for that member only",
      asSelf.length === 2 && asOther.length === 0,
      { asSelf: asSelf.length, asOther: asOther.length },
    );

    check(
      "a passage can't be written under another chapter than its source's",
      await refused(() =>
        db.query(
          `insert into corpus_chunks
             (chapter_id, corpus_source_id, chunk_index, content, embedding_model, embedding)
           values ($1, $2, 9, 'smuggled', $3, $4::extensions.vector(1536))`,
          [CH_B, srcA.id, MODEL, SAME],
        ),
      ),
      {},
    );
    check(
      "a source type outside the list (vault, rush, backwork) can't be written",
      await refused(() =>
        db.query(
          `insert into corpus_sources (chapter_id, source_type, source_id)
           values ($1, 'backwork_resource', gen_random_uuid())`,
          [CH_A],
        ),
      ),
      {},
    );

    const fns = [
      "public.match_corpus_chunks(uuid, uuid, text, text, text, integer)",
      "public.write_corpus_chunks(uuid, bigint, boolean, text, jsonb)",
      "public.finish_corpus_source(uuid, bigint, text, text, timestamptz, boolean, integer, text, integer, uuid[])",
      "public.claim_corpus_sources(text, timestamptz, integer)",
      "public.note_corpus_source(uuid, text, uuid, uuid)",
      "public.drop_corpus_source(uuid, text, uuid)",
    ];
    const grants = [];
    for (const fn of fns) {
      for (const role of ["anon", "authenticated"]) {
        const [g] = await rows(
          `select has_function_privilege($1, $2, 'execute') as ok`,
          [role, fn],
        );
        if (g.ok !== false) grants.push(`${role}: ${fn}`);
      }
    }
    const [serviceGrant] = await rows(
      `select has_function_privilege('service_role', $1, 'execute') as ok`,
      [fns[0]],
    );
    check(
      "neither client role may execute a corpus function; the service role may",
      grants.length === 0 && serviceGrant.ok === true,
      { grants, serviceGrant },
    );

    // ── Retrieval ────────────────────────────────────────────────────────
    const dues = aInA.find((r) => r.content === SENTENCE);
    check(
      "a passage both halves find carries both ranks and its provenance",
      dues?.dense_rank === 1 &&
        dues?.sparse_rank === 1 &&
        dues.title === "Bylaws" &&
        dues.heading === "Article IV: Dues" &&
        dues.source_type === "chapter_document" &&
        Math.abs(Number(dues.distance)) < 1e-6,
      { dues },
    );
    const exact = await match(CH_A, U_A, "who keeps the ritual equipment?");
    const quarter = exact.find((r) => r.content.includes("quartermaster"));
    check(
      "an exact word is found by the word half, any word of the question counting",
      quarter?.sparse_rank === 1 &&
        exact.find((r) => r.content === SENTENCE)?.sparse_rank == null,
      { exact: exact.map((r) => [r.content.slice(0, 20), r.dense_rank, r.sparse_rank]) },
    );
    const otherModel = await match(CH_A, U_A, "dues", SAME, "another-model");
    check(
      "passages embedded with another model stay out of the nearest list",
      otherModel.length === 1 &&
        otherModel[0].dense_rank == null &&
        otherModel[0].sparse_rank === 1,
      { otherModel: otherModel.map((r) => [r.dense_rank, r.sparse_rank]) },
    );
    check(
      "a question of only stopwords, or an empty one, still returns the nearest passages",
      (await match(CH_A, U_A, "the of and")).every((r) => r.sparse_rank == null) &&
        (await match(CH_A, U_A, "")).length === 2,
      {},
    );

    // ── Following the sources: change and delete ─────────────────────────
    await db.query(`update chapter_documents set folder = 'Governance' where id = $1`, [DOC_A]);
    check(
      "moving a document to a folder is not a change to its text",
      Number((await sourceOf("chapter_document", DOC_A)).revision) === 1 &&
        (await chunkCount(srcA.id)) === 2,
      {},
    );

    await db.query(`update chapter_documents set title = 'Bylaws (2026)' where id = $1`, [DOC_A]);
    const changed = await sourceOf("chapter_document", DOC_A);
    check(
      "a changed document loses its passages at once and waits to be indexed again",
      Number(changed.revision) === 2 &&
        changed.status === "pending" &&
        Number(changed.indexed_revision) === 1 &&
        (await chunkCount(srcA.id)) === 0 &&
        (await match(CH_A, U_A, "dues")).length === 0,
      { changed },
    );
    check(
      "a write for the older revision writes nothing and says so",
      (await write(srcA.id, 1, [chunk(0, SENTENCE, SAME)])) === false &&
        (await finish(srcA.id, 1, 1, "Bylaws")) === false &&
        (await chunkCount(srcA.id)) === 0,
      {},
    );
    check(
      "the current revision writes in batches, and finishing trims what is past the count",
      (await write(srcA.id, 2, [chunk(0, SENTENCE, SAME), chunk(1, "One.", OTHER)])) === true &&
        (await write(srcA.id, 2, [chunk(2, "Two.", OTHER)], false)) === true &&
        (await chunkCount(srcA.id)) === 3 &&
        (await finish(srcA.id, 2, 2, "Bylaws (2026)")) === true &&
        (await chunkCount(srcA.id)) === 2 &&
        (await sourceOf("chapter_document", DOC_A)).status === "indexed",
      {},
    );

    // Indexing again at the same revision, as a new embedding model does.
    await write(srcA.id, 2, [chunk(0, SENTENCE, SAME)]);
    const midway = await sourceOf("chapter_document", DOC_A);
    check(
      "a source being indexed again is not read between its first batch and its finish",
      midway.status === "pending" &&
        Number(midway.indexed_revision) === 0 &&
        (await chunkCount(srcA.id)) === 1 &&
        (await match(CH_A, U_A, "dues")).length === 0,
      { midway },
    );
    check(
      "and is read again once it is finished",
      (await write(srcA.id, 2, [chunk(1, "One.", OTHER)], false)) === true &&
        (await finish(srcA.id, 2, 2, "Bylaws (2026)")) === true &&
        (await match(CH_A, U_A, "dues")).length === 2,
      {},
    );

    await db.query(`update chapter_documents set effective_date = '2026-08-15' where id = $1`, [DOC_A]);
    const redated = await sourceOf("chapter_document", DOC_A);
    check(
      "a document's effective date is part of what is indexed, so changing it queues it again",
      Number(redated.revision) === 3 && redated.status === "pending",
      { redated },
    );
    await db.query(`update chapter_documents set storage_path = 'a/bylaws-v2.pdf' where id = $1`, [DOC_A]);
    check(
      "so is its file",
      Number((await sourceOf("chapter_document", DOC_A)).revision) === 4,
      {},
    );

    // A second document, to be skipped and then deleted.
    await db.query(
      `insert into chapter_documents (id, chapter_id, title, storage_path, uploaded_by)
       values ($1, $2, 'Budget', 'a/budget.xlsx', $3)`,
      [DOC_A2, CH_A, U_A],
    );
    const srcA2 = await sourceOf("chapter_document", DOC_A2);
    await finish(srcA2.id, 1, 0, null, "unsupported_type");
    const skipped = await sourceOf("chapter_document", DOC_A2);
    check(
      "a source the indexer can't read is recorded as skipped, with the reason",
      skipped.status === "skipped" &&
        skipped.skip_reason === "unsupported_type" &&
        Number(skipped.indexed_revision) === 1,
      { skipped },
    );

    await db.query(`delete from chapter_documents where id = $1`, [DOC_A]);
    check(
      "a deleted document's source row and passages are gone in the same statement",
      (await sourceOf("chapter_document", DOC_A)) === undefined &&
        (await chunkCount(srcA.id)) === 0 &&
        (await match(CH_A, U_A, "dues")).length === 0 &&
        (await match(CH_B, U_B, "dues")).length === 1,
      {},
    );

    // ── Minutes ──────────────────────────────────────────────────────────
    await db.query(
      `insert into meetings (id, chapter_id, event_name, event_start_time, meeting_type, status, content, created_by)
       values ($1, $2, 'Chapter meeting', now(), 'chapter', 'draft', '{"summary":"Draft."}'::jsonb, $3)`,
      [MEET_A, CH_A, U_A],
    );
    check(
      "draft minutes are not a source",
      (await sourceOf("meeting_minutes", MEET_A)) === undefined,
      {},
    );
    await db.query(
      `update meetings set status = 'posted', posted_at = now(), posted_by = $2, updated_by = $2 where id = $1`,
      [MEET_A, U_AB],
    );
    const posted = await sourceOf("meeting_minutes", MEET_A);
    check(
      "posting minutes makes them a waiting source, for whoever posted them",
      posted?.status === "pending" && posted.changed_by === U_AB && Number(posted.revision) === 1,
      { posted },
    );
    await write(posted.id, 1, [chunk(0, "Voted to move formal to April 12.", SAME, "Decisions")]);
    await finish(posted.id, 1, 1, "Chapter meeting minutes");
    await db.query(
      `update meetings set content = '{"summary":"Edited."}'::jsonb where id = $1`,
      [MEET_A],
    );
    const edited = await sourceOf("meeting_minutes", MEET_A);
    check(
      "editing posted minutes drops their passages and queues them again",
      Number(edited.revision) === 2 &&
        edited.status === "pending" &&
        (await chunkCount(posted.id)) === 0,
      { edited },
    );
    await db.query(`update meetings set event_name = 'Chapter meeting, week 9' where id = $1`, [MEET_A]);
    check(
      "renaming the meeting changes the minutes' title, so it queues them again",
      Number((await sourceOf("meeting_minutes", MEET_A)).revision) === 3,
      {},
    );

    // The backfill at the end of the migration, run again over these rows:
    // the gate replays migrations on an empty database, where it enrols
    // nothing, so this is the only place it meets a document or minutes.
    const backfill = readFileSync(
      new URL("../../../supabase/migrations/20261112140150_ai_corpus.sql", import.meta.url),
      "utf8",
    ).split("-- ─── Existing documents and posted minutes wait to be indexed")[1];
    await db.query(`delete from corpus_sources where chapter_id = $1`, [CH_A]);
    await db.query(
      `insert into meetings (id, chapter_id, event_name, event_start_time, meeting_type, status, content, created_by)
       values (gen_random_uuid(), $1, 'Unposted', now(), 'chapter', 'draft', '{}'::jsonb, $2)`,
      [CH_A, U_A],
    );
    await db.exec(backfill.slice(backfill.indexOf("\n")));
    const enrolled = await rows(
      `select source_type, source_id, status, changed_by from corpus_sources where chapter_id = $1 order by source_type, source_id`,
      [CH_A],
    );
    check(
      "the backfill enrols every existing document and posted minutes as waiting, and no draft",
      enrolled.length === 2 &&
        enrolled[0].source_type === "chapter_document" &&
        enrolled[0].source_id === DOC_A2 &&
        enrolled[0].changed_by === U_A &&
        enrolled[1].source_type === "meeting_minutes" &&
        enrolled[1].source_id === MEET_A &&
        enrolled.every((r) => r.status === "pending"),
      { enrolled },
    );

    // Back to how the budget stood before the backfill check: skipped.
    await finish(enrolled[0] && (await sourceOf("chapter_document", DOC_A2)).id, 1, 0, null, "unsupported_type");

    await db.query(
      `update meetings set status = 'draft', posted_at = null, posted_by = null where id = $1`,
      [MEET_A],
    );
    check(
      "minutes that are no longer posted stop being a source",
      (await sourceOf("meeting_minutes", MEET_A)) === undefined,
      {},
    );
    await db.query(
      `update meetings set status = 'posted', posted_at = now(), posted_by = $2 where id = $1`,
      [MEET_A, U_A],
    );
    await db.query(`delete from meetings where id = $1`, [MEET_A]);
    check(
      "deleting minutes removes their source",
      (await sourceOf("meeting_minutes", MEET_A)) === undefined,
      {},
    );
    check(
      "a Standards meeting has no row to index: the table refuses the type",
      await refused(() =>
        db.query(
          `insert into meetings (chapter_id, event_name, event_start_time, meeting_type)
           values ($1, 'Hearing', now(), 'standards')`,
          [CH_A],
        ),
      ),
      {},
    );

    // ── Claiming ─────────────────────────────────────────────────────────
    // What is left: A's skipped budget (fingerprint FP), B's indexed bylaws
    // (FP). Add one waiting document in A.
    await db.query(
      `insert into chapter_documents (id, chapter_id, title, storage_path, uploaded_by)
       values ($1, $2, 'Bylaws', 'a/bylaws-2.pdf', $3)`,
      [DOC_A, CH_A, U_A],
    );
    const mine = `source_id in ('${DOC_A}', '${DOC_A2}', '${DOC_B}')`;
    const claim = async (fingerprint, at) =>
      (
        await rows(
          `select c.source_id, c.attempts, c.next_attempt_at
             from claim_corpus_sources($1, $2::timestamptz, 500) c
            where c.${mine}`,
          [fingerprint, at],
        )
      );
    const t0 = new Date(Date.now() + 60_000).toISOString();
    const first = await claim(FP, t0);
    check(
      "claiming hands out the waiting source only, and counts the attempt",
      first.length === 1 && first[0].source_id === DOC_A && first[0].attempts === 1,
      { first },
    );
    check(
      "a claimed source is not handed out again until its wait is over",
      (await claim(FP, t0)).length === 0 &&
        new Date(first[0].next_attempt_at).getTime() - new Date(t0).getTime() === 600_000,
      { next: first[0].next_attempt_at, t0 },
    );
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const stale = await claim("another-model.1536.p1", later);
    check(
      "under a new fingerprint every source indexed or skipped under the old one is claimed again",
      stale.map((r) => r.source_id).sort().join() === [DOC_A, DOC_A2, DOC_B].sort().join(),
      { stale: stale.map((r) => r.source_id) },
    );

    // ── Chapter deletion ─────────────────────────────────────────────────
    await db.query(`delete from chapter_documents where chapter_id = $1`, [CH_B]);
    await db.query(`delete from members where chapter_id = $1`, [CH_B]);
    await db.query(`delete from chapters where id = $1`, [CH_B]);
    const [left] = await rows(
      `select (select count(*) from corpus_sources where chapter_id = $1)::int as sources,
              (select count(*) from corpus_chunks where chapter_id = $1)::int as chunks`,
      [CH_B],
    );
    check(
      "deleting a chapter leaves none of its sources or passages",
      left.sources === 0 && left.chunks === 0,
      { left },
    );
  } catch (e) {
    check("the tier ran to the end", false, {
      error: String(e?.message ?? e).split("\n")[0],
    });
  } finally {
    await db.exec("rollback");
    // In case a failure left the stub pointing at a member.
    await db.exec(
      `create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;`,
    );
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`OK    ${r.name}`);
    } else {
      miss();
      console.log(
        `MISS  ${r.name}\n        ↳ ${JSON.stringify(r.detail).slice(0, 600)}`,
      );
    }
  }
}
