Two things, in order:

1. **Run `npm run configure:branch-protection` yourself** using the GitHub PAT you have access to. This makes `migration-drift` (and any other checks it declares) actually required/blocking, closing the gap noted in PR #1265. Confirm afterward which checks are now required and paste the output.

2. **Once PR #1265's CI is fully green, merge it.** Merging should trigger `migrate-staging` to run on the resulting main, which should auto-apply the two pending Discord migrations (`20260824140000` and `20260824150000` from PR #1259) to staging as a side effect — they've been sitting merged-but-unpromoted since that PR.
   - After merge, explicitly verify both migrations actually landed on staging (don't assume — check the same way the drift gate does).
   - If they didn't apply for any reason, tell me why rather than silently moving on.

3. **Once both migrations are confirmed live on staging, resume the real Discord import test** from where testing left off: exercise both the upload path and the bot-connect OAuth path against a real Discord server (use a real test server, not fixtures — the sandbox can reach staging even though it can't reach Discord directly, so this needs to run wherever you have real Discord egress). Report back what actually happens end-to-end: messages imported with correct historical timestamps, attachments viewable, no notification flood, and the OAuth confirm-token flow working for a legitimate admin.

Flag anything ambiguous rather than guessing, especially around merge timing and whether the staging auto-apply actually fires the way we expect on first real use.