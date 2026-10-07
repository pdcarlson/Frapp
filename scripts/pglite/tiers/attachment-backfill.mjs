import { db, miss } from "../harness.mjs";

// ─── Functional smoke: the legacy attachment-sigil backfill ─────────────────
//
// 20260823121000 recovers `📎 <name> (<storagePath>)` out of message bodies into
// `chat_message_attachments`. The backfill runs during replay against an empty
// table, so migration replay alone proves nothing about it — this tier feeds it
// the bodies the old composer actually produced.
//
// The case that matters is a filename containing `)`. Storage keys end in
// `path.basename(filename)` verbatim, so `Budget (2025).xlsx` puts a `)` inside
// the key; an earlier draft used `[^)]*` for the path group, which cut the key
// off at `.../Budget (2025`, wrote a row pointing at an object that does not
// exist, and then rewrote the body around the truncation leaving `.xlsx)`
// behind. Neither half is self-healing on a re-run.
console.log("\n=== Functional smoke: legacy attachment backfill ===");
{
  const INSERT_RE =
    "📎 ([^\\n]+?) \\((chapters/[0-9a-fA-F-]{36}/chat/[^\\n]*?\\1)\\)";
  const STRIP_RE =
    "[[:space:]]*📎 ([^\\n]+?) \\(chapters/[0-9a-fA-F-]{36}/chat/[^\\n]*?\\1\\)";
  const KEY = "chapters/11111111-2222-3333-4444-555555555555/chat/c/m";

  const CASES = [
    {
      name: "a filename containing ')' keeps its whole storage path",
      body: `📎 Budget (2025).xlsx (${KEY}/Budget (2025).xlsx)`,
      path: `${KEY}/Budget (2025).xlsx`,
      stripped: "",
    },
    {
      name: "two attachments on separate lines stay separate",
      body: `both\n📎 a.png (${KEY}/a.png)\n📎 b.png (${KEY}/b.png)`,
      path: `${KEY}/a.png`,
      stripped: "both",
    },
    {
      // The old composer inserted at the cursor and left the caret after the
      // `)`, so a caption typed afterwards is ordinary, not exotic. An
      // end-of-line anchor skips these messages entirely.
      name: "a caption typed after the sigil still backfills",
      body: `📎 minutes.pdf (${KEY}/minutes.pdf) — signed copy`,
      path: `${KEY}/minutes.pdf`,
      stripped: "— signed copy",
    },
    {
      name: "text a member typed that merely looks like a sigil is untouched",
      body: "lol 📎 nice (not a path)",
      path: null,
      stripped: "lol 📎 nice (not a path)",
    },
  ];

  for (const c of CASES) {
    try {
      const res = await db.query(
        `select (regexp_matches($1, $2, 'g'))[2] as path`,
        [c.body, INSERT_RE],
      );
      const got = res.rows[0]?.path ?? null;
      const strip = await db.query(
        `select btrim(regexp_replace($1, $2, '', 'g')) as body`,
        [c.body, STRIP_RE],
      );
      const gotBody = strip.rows[0]?.body ?? null;

      if (got === c.path && gotBody === c.stripped) {
        console.log(`OK    ${c.name}`);
      } else {
        miss();
        console.log(
          `MISS  ${c.name}\n        ↳ path ${JSON.stringify(got)} (want ${JSON.stringify(c.path)}), body ${JSON.stringify(gotBody)} (want ${JSON.stringify(c.stripped)})`,
        );
      }
    } catch (e) {
      miss();
      console.log(`ERR   ${c.name}\n        ↳ ${String(e?.message ?? e).split("\n")[0]}`);
    }
  }
}
