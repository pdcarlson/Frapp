Run this in Cursor as a new background agent / goal, cut from latest `main`. Three small, independent, no-decision items.

---

1. **Fix `spec/behavior/events.md`.** It still documents the check-in mint route as POST; the actual route (`attendance.controller.ts`) is GET (`GET /v1/events/:eventId/attendance/check-in-token`), reconfirmed in #1121 and earlier sessions. Correct the spec to GET. This is a docs fix, not a code change — do not touch the controller.

2. **Fix `supabase-task.repository.spec.ts` test data.** It seeds `status: 'PENDING'`, which is not a real `TaskStatus` value. Check the actual `TaskStatus` enum/union and replace with a correct value that preserves the test's original intent (check what state the test is trying to represent — likely `TODO` or similar).

3. **Confirm whether issue #342's stale suggested-fix text was corrected.** An earlier prompt asked for a comment on #342 correcting its suggested-fix text (which cited the old PNG/JPG/WebP/2MB rule, since replaced by the shared `image` kind in #1113). Check if that comment was posted. If not, post it: implementers should call `inspectUploadFile("image", file)` and use `MAX_UPLOAD_LABEL`, not a private MIME/size list. If GitHub MCP is down, report that explicitly instead of skipping silently.

**Test plan to report back:** `check-docs-impact.mjs` for item 1, scoped repository test run for item 2, and explicit confirmation (posted / already done / blocked by MCP) for item 3.