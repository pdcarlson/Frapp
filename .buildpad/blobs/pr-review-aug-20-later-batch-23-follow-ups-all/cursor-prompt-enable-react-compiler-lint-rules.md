Run this in Cursor as a new background agent / goal, cut from latest `main`. This is a dedicated cleanup pass, not a quick fix — expect it to touch real files across web and mobile, and expect it to need review, not auto-merge.

---

**Context:** #1108 bumped `eslint-plugin-react-hooks` from 5.2.0 to 7.1.1. The 7.x `recommended` config turns on React Compiler lint rules (`set-state-in-effect`, ref validation, and related checks) in addition to the existing `rules-of-hooks` / `exhaustive-deps`. Those new rules found real findings — 26 on mobile, 37 on web (locally) — that would fail `--max-warnings 0`. #1108 deliberately held the compiler-rule subset at `"off"` in `packages/eslint-config/react-hooks.js` to avoid rewriting unrelated code inside a dependency-bump PR. `rules-of-hooks` and `exhaustive-deps` are already at upstream severity and unaffected.

**What to do:**

1. Turn the held-off compiler rules back on in `packages/eslint-config/react-hooks.js` (one rule at a time, not all at once, so each can be evaluated on its own).
2. For each rule, run lint and look at what fires. The findings are concentrated in auth, chat, realtime, and RN animation code — areas doing intentional ref-sync or effect-synced state, which is exactly the kind of code these compiler rules are strictest about. For each finding, decide:
   - Is this a real bug the compiler rule caught (fix it), or
   - Is this an intentional pattern the rule is flagging as a false positive / acceptable tradeoff (add a scoped, justified disable comment, not a blanket rule-level `"off"`)?
3. Do not do this as one giant diff. Land it as a small number of focused PRs, grouped by area (e.g. one for auth, one for chat, one for realtime, one for RN animation) so each is reviewable and revertable independently.
4. Once a rule's findings are all resolved (fixed or justified), flip it to its real severity in the shared config and remove it from the "held off" list. If any rule still has unresolved findings by the end of this pass, leave it off, and report exactly which rule and how many findings remain.

**Test plan to report back per PR:** `npm run lint` (both web and mobile, 0 warnings target), full check-types, the scoped test suites for whatever files were touched, and a clear list of which rules are now fully enabled vs still held off with a reason.