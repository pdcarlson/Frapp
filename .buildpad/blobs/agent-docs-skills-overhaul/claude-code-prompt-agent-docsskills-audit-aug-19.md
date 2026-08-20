I want to overhaul how we document project knowledge for you and future agents — no code changes, just a thorough audit and honest opinions.

**1. Current CLAUDE.md(s)**
List every CLAUDE.md in the repo (root and any nested ones). For each: line count, rough token count, when it was last substantially edited, and your honest read — does it read like a tight rulebook, or has it become a dumping ground? Flag any lines that are: (a) stale/contradicted by the current code, (b) things you'd do correctly without being told, (c) one-off task history or changelog entries that shouldn't be there, (d) rules that contradict each other.

**2. spec/ directory**
Inventory every file in spec/. For each: what it's for, roughly how big, and whether it's actually load-bearing (agents genuinely reference it) or effectively dead weight. Specifically check spec/ui/brand-identity.md (I know it's stale — locks in an old light-first direction) and spec/behavior/meetings.md and spec/behavior/ai.md (both fully specced, zero built) — are these still accurate to our actual direction, and is anything in them actively misleading?

**3. Existing skills/commands/subagents/hooks**
Do we have anything in .claude/skills/, .claude/commands/, .claude/agents/, or .claude/hooks/, or a settings.json hooks block? List what exists, what each does, and whether any of it is unused/orphaned.

**4. TECH-DEBT.md**
Does this exist yet (we discussed adding it earlier)? If so, what's in it and is it actually being maintained/referenced, or has it gone stale too?

**5. Naming: Frapp vs Signet**
Give me a real count: how many places still say "Frapp" vs "Signet" — repo name, package.json names, env var prefixes, DB/schema names, doc titles, code comments, error messages, UI strings. Be specific about which of these are cheap to rename later vs which are load-bearing/risky to change (e.g. DB names, published package names).

**6. Where rigidity is hurting us**
This is the important one: point out any specific places where our current docs are over-specifying things — giving you rules for cases you'd have handled fine with judgment, or where two docs disagree and you've had to silently pick one. Be honest and specific, not diplomatic.

**7. Recurring task patterns**
Looking at how work has actually gotten done in this repo (module reskins, spec-writing, RAG/eval work, tech-debt sweeps, etc.) — what are the 3-6 recurring "archetypes" of task we do over and over, that would benefit from being turned into a proper skill or subagent rather than re-explained each time?

Give me a structured report. Don't fix anything yet — I want the full picture before we redesign the structure.