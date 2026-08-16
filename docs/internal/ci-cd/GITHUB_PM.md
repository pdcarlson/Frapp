# GitHub Issues as the canonical PM system

Canonical, version-controlled design + policy for Frapp's project management on **GitHub Issues**
(`pdcarlson/Frapp`), per **ADR-16** and its GitHub-migration amendment (`spec/architecture/README.md`).
GitHub Issues is the source of truth for planning and work status. Linear is **retired** — the
decision record, viability probes, and the FRA-→#N migration mapping live in
[issue #680](https://github.com/pdcarlson/Frapp/issues/680).

> **Status: live** (migrated 2026-08-08). Every open Linear issue either already had a GitHub twin
> (the June import) or was recreated as a GitHub issue during the migration; open issues carry
> priority labels. The Linear workspace stays readable until the owner deletes it; no repo
> contract reads or writes it. (Caveat until the owner finishes the wind-down: the legacy
> scheduled Routines and the still-connected Linear GitHub integration can touch it — see
> [`ROUTINES.md`](ROUTINES.md#how-to-create-them-ui) step 7 and #680's checklist.)
>
> **Why the migration:** Linear's MCP write tools (`save_issue` etc.) required a manual permission
> approval in every Claude Code cloud session, and three config-level fixes (#667, #669, #676)
> failed to stop the prompts. The GitHub MCP server is pre-approved by the cloud harness
> (`mcp__github__*` in its `--allowed-tools`), so agents can file, label, and close issues
> unattended. Full evidence trail: #680.

---

## The model

```
GitHub Issues (canonical: planning, status, Triage intake)
   ▲ Claude Code (web) via the GitHub MCP — the path /next uses
   ▲ Claude Code Routines (scheduled: curator + triage + PR follow-ups) via the same GitHub MCP
   ▲ PRs close work natively (Fixes #N on merge)
```

- **GitHub Issues is canonical** for what to work on and its status. There is **no fallback
  tracker** — if the GitHub MCP is down, `/next` and the routines stop rather than guessing.
- **All issues are opened on GitHub with the `triage` label.** Never in Linear (retired), never in
  a scratch file. Sole carve-out: **`routine-state`** infrastructure issues (e.g. the
  "PR Follow-ups — Human Action List" tracking issue) are not work and carry `routine-state`
  instead — `/next` and the routines skip them entirely.
- **Work is closed by the PR that does it** (`Fixes #N` in the PR **body** — native GitHub
  close-on-merge, one line per issue the PR closes; GitHub ignores closing keywords in the PR
  *title*, so the body is load-bearing). Agents may also close an issue directly when it's done,
  obsolete, or a duplicate — see the state table below.
- **Epics are parent issues with native sub-issues** (`sub_issue_write` /
  `issue_read get_sub_issues`). Linear Projects are retired; `project:<slug>` labels may be used
  ad hoc, sparingly, but are not a provisioned taxonomy.
- **Triage is the intake.** New work — human-filed, `/next` follow-ups, curator suggestions —
  is born with the `triage` label and is accepted into the Backlog (label removed, priority set)
  before `/next` will auto-start it. One carve-out: a `/next` run that fixes a defect it discovered
  on its own branch may file the issue and claim it in the same breath — record-keeping for work
  already underway, not auto-starting inbox work.

### How agents reach the tracker

| Actor | Reaches GitHub Issues via | Notes |
| --- | --- | --- |
| **Claude Code** (web, interactive) | **GitHub MCP** (`mcp__github__issue_write` / `issue_read` / `list_issues` / `search_issues` / `add_issue_comment` / `sub_issue_write`) | The only sanctioned path. Shell access to `api.github.com` is session-dependent — observed proxy-blocked (403 "GitHub access is not enabled for this session") and working, both on 2026-08-08 — so never rely on `gh`/REST from a sandbox. No fallback tracker. |
| **Claude Code Routines** (scheduled) | The **same GitHub MCP** — routine sessions run in the same web environment | If the MCP is unavailable at fire time, the routine stops and reports. See [`ROUTINES.md`](ROUTINES.md). |
| **CI / scripts** | `GITHUB_TOKEN` / `GITHUB_PAT` inside GitHub Actions only | The PAT works in Actions and on laptops, **not** in cloud sandboxes. PAT policy: [`AGENT_INFRA.md`](AGENT_INFRA.md). |

---

## States (labels + native issue state)

GitHub has no workflow states, so the board states are a convention over labels and the native
open/closed + `state_reason` fields:

| State | Representation |
| --- | --- |
| **Triage** (intake) | open + **`triage`** label |
| **Backlog** (accepted, ready) | open, no state label. A priority label is the *expected* state (promotion requires setting one), but unprioritized Backlog issues exist (e.g. migrated ones) — `/next` ranks them last and the triage routine's grooming pass is what fixes them; never "fix" one by re-adding `triage` |
| **In Progress** | open + **`in-progress`** label — a projection of a live `AGENT-CLAIM` comment (the claim protocol in [`next.md`](../../../.claude/commands/next.md) is authoritative) |
| **In Review** | open + **`in-review`** label + a linked open PR |
| **Done** | closed as **`completed`** (usually by `Fixes #N` on merge) |
| **Canceled** | closed as **`not_planned`** |
| **Duplicate** | closed as **`duplicate`** with `duplicate_of` naming the canonical issue |

**Promotion out of Triage requires setting a priority label** — mirroring Linear's "require
explicit prioritization" rule. Remove `triage` and add exactly one `P1`–`P4` in the same update.

## Labels and priority (lean taxonomy)

- **Priority is a label:** **`P1`** (urgent — drop everything) · **`P2`** (high) · **`P3`**
  (medium) · **`P4`** (low). Exactly one per triaged issue; absent = unprioritized (ranked last,
  not startable out of Triage). Mapped 1:1 from Linear's Urgent/High/Medium/Low at migration.
- **`area:<x>`** groups by surface (`api`/`web`/`db`/`ci`/`security`/`ux`/`product`/`research`/
  `docs`/`deps`).
- **`suggestion`** is the routine-ownership marker (which issues the backlog routines own) — the
  hard boundary for destructive routine writes.
- **`stale`** marks an aging suggestion that can't be *proven* resolved — kept, left open.
- **`triage`**, **`in-progress`**, **`in-review`** are the state labels above.
- **`routine-state`** marks routine infrastructure issues (cross-run state stores, never work) —
  excluded from `/next` candidacy and from every routine's triage/grooming scope.
- **`scope:production`** marks work that only becomes relevant once a production environment
  exists. Added 2026-08-10 on the owner's decision to defer production and make staging the
  near-term goal. These issues are **parked by choice, not blocked and not stale**: routines must
  not mark them `stale`, must not raise their priority for age, and must not re-file duplicates of
  them. `frapp-prod` being paused, the production Render service being suspended, and `frapp-web`
  having no production deployment are all intentional states, not findings. Revisit when
  production becomes a goal; see #814 for the decision record.
- Legacy labels from the pre-Linear era (`bug`, `Improvement`, `release:*`) persist on old issues;
  `release:*` still drives version bumps ([`AGENT_INFRA.md`](AGENT_INFRA.md)). Don't extend the
  legacy set to new issues.
- Labels **auto-create on first use** (verified 2026-08-08: applying a nonexistent label via
  `issue_write` creates it), so there is no provisioning step — but stick to the taxonomy above;
  a typo'd label is a real label.

**Blocked-by has no native relation.** Express dependencies as a **`Blocked by #N`** line in the
issue body's meta block. `/next` §1.1 verifies blockers against the repo, not the tracker, before
honoring them; the triage routine adds/corrects the lines.

**`[human]` items are held by their title, not by `triage`.** The hold rule below keys on the
`[human]` prefix, but until 2026-08-16 the only thing that actually kept `/next` off them was the
`triage` label — so any routine or human that promoted one exposed it (#709 was already through).
`/next` §0.2 now reads the title directly; the label is a convenience. Match the **whole leading
bracket run**, case-insensitively: `[pr-followup][human] …` (#805, #806, #811–#813, #826) does not
begin with `[human]`. The `**Human action required — hold in triage` body opener is the third
recognised form, for items predating the prefix (#908, and #765/#689 which carry no bracket at
all).

**Epics ARE claimable, deliberately.** `/next` exists to always find an agent useful work, so its
candidacy filter stays permissive: it excludes only what an agent genuinely cannot do. A parent
issue is ordinary work — an agent picking up an epic and shipping a slice of it is a good outcome,
not a failure mode, and there is **no epic filter in §0.2**. Do not add one, and do not add an
`epic` label expecting it to gate anything.

**What is guarded is closing an epic, not claiming one.** The real hazard is a single-slice PR
carrying `Fixes #<epic>`: the merge closes the parent with its remaining slices unwritten, and
unlike a claim, a merge is not reversible. So the rule lives at PR-authoring time (`/next` Phase 4):

> `issue_read get` each issue the PR names. When `has_children: true` and any child is still open,
> write **`Part of #N`** instead of `Fixes #N`. `Fixes` is correct again once
> `sub_issues_summary` shows `completed >= total`, or when every open child is a member of the
> same PR.

Gate that on `has_children`, **not** `sub_issues_summary` alone — the summary is documented as
*optional* and is returned only when children exist (verified 2026-08-16: #426 carries both, #718
and #947 carry neither), so `total > completed` reads `undefined > undefined` → false when it is
missing and fails open into the irreversible case.

**Attach an epic's slices as native sub-issues when you file them.** That is what makes the Phase 4
guard able to see them at all. #718 and #720 are both `[Epic]` with `has_children: false` because
nobody ever attached their slices — a PR could close either with `Fixes` today and nothing would
notice. `Blocked by #N` lines remain worth adding on such an epic; §1.1 re-verifies them against
the repo, so they degrade honestly as slices land.

**Estimates** are an optional **`Estimate: <fibonacci>`** line in the body meta block (0,1,2,3,5,
8,13,21) — sizing context for `/next`'s batching caps, never a filter or gate.

## Agent briefs (depth / model / ultracode)

Unchanged from the Linear era. An issue's description may carry a machine-readable
**`### Agent brief`** section:

```markdown
### Agent brief
`depth:<skim|standard|deep>` · `model:<fable|any>` · `ultracode:<yes|no>`
<optional one line on where the depth should go>
```

- **`depth`** — how far past the literal ask to investigate. `skim`: genuinely mechanical;
  `standard`: well-bounded single-surface work; `deep`: load the subsystem, verify against spec
  **and** runtime, hunt adjacent defects, widen review. **Default is `deep`** — an absent brief or
  field means `deep`.
- **`model`** — suggested tier for the session that picks it up (`fable` for cross-cutting,
  architectural, security-sensitive, or subtle-correctness work). Advisory, read at spin-up.
- **`ultracode`** — whether multi-agent orchestration likely pays for itself.

**Who writes it:** the curator files every suggestion with a brief; the triage routine backfills
and corrects briefs on `suggestion`-owned issues only. Human-filed issues get a brief only from a
human; an absent brief reads as `depth:deep`. **Who reads it:** `/next` honors `depth` when
scaling verification and review (never skipping steps, never shrinking `/diff-review`).

## `/next` (the work-selection command)

[`.claude/commands/next.md`](../../../.claude/commands/next.md) is the canonical entry point: pull
the **Backlog** (open, non-`triage`, unclaimed) ranked by **priority label** (P1→P4; unlabeled
last), tie-break by lower issue number, drop anything with a live `Blocked by #N` (verified against
the repo), never auto-start `triage` items, and **stop if the GitHub MCP is unavailable**. It keeps
the tracker in sync (`in-progress` on claim, a comment trail, the PR link) and opens the PR with
`Fixes #N`.

- **The claim is a comment; the label is a projection of it.** GitHub has no compare-and-swap —
  `issue_write` is last-write-wins. Issue comments are append-only and server-timestamped
  (`created_at`), so the `AGENT-CLAIM` / `AGENT-HEARTBEAT` / `AGENT-RELEASE` protocol carries over
  from the Linear era unchanged in design. One GitHub-specific delta: the MCP **cannot edit
  comments**, so leases renew by posting a fresh `AGENT-HEARTBEAT` comment (same `claim_id`);
  liveness is judged on the newest heartbeat's server timestamp.
- **Claim first, verify second.** Selection and claim happen before expensive verification.
- **Assignees tell you nothing.** The only evidence of live work is a live claim comment, a branch
  named in one, or a linked PR.
- **Leases and leaked claims:** 4-hour lease renewed per heartbeat; expired-lease takeover via
  `AGENT-RECLAIM`; an `in-progress` issue with no claim comment and no linked PR for 72h is
  swept back to Backlog (label removed) with an `AGENT-STALE-FLAG`.
- **Closing:** on merge, `Fixes #N` closes each named issue as `completed` natively — no tool call
  needed (a parity *win* over Linear, whose close-sync needed babysitting). Direct closes use
  `issue_write` with `state: closed` + the right `state_reason` (`completed` / `not_planned` /
  `duplicate` + `duplicate_of`).

Procedure lives in `next.md`; this section is policy. Where they disagree, this document wins.

## Filing an issue (agents)

Everything an agent files (follow-ups from `/next`, curator suggestions, PR-followup harvest):

- Born **open + `triage`** with a **priority label** proposed (the triage routine confirms),
  **`suggestion`** when routine-owned, exactly one **`area:<x>`**.
- Body: summary · meta block (`Blocked by #N` / `Estimate:` as applicable) · problem/context with
  exact `file:line` refs · acceptance criteria (objectively verifiable checkboxes) · an
  **Agent brief**.
- **`fp=` dedup markers are the routines' mechanism, per-namespace:** the curator embeds
  `<!-- agent-suggestion: v1 fp=<area>/<slug> file=<path> -->`; the PR Follow-ups harvester embeds
  `<!-- agent-suggestion: v1 fp=pr-followup/<slug> pr=#<N> -->`; human-action blockers (filed by
  *any* session, see below) embed `<!-- agent-suggestion: v1 fp=human/<slug> source=<...> -->`
  (namespaces partition lifecycle ownership — PR Follow-ups owns both `pr-followup/` and
  `human/`). Ad-hoc filings (`/next` follow-ups, review deferrals) need no marker.
- **Search before filing** (`search_issues`, open **and** closed) — refresh a near-match instead
  of duplicating it. This applies to every filing path, marker or not.
- **Human-action blockers (owner mandate 2026-08-12):** when an agent has *proven* a step needs
  the human (environment config, missing credential/account, dashboard-only step, purchase — and
  no better-provisioned agent session could do it either), it must file the blocker — title
  **`[human] <imperative action>`**, labels `triage` + `suggestion` + one `area:<x>` + a
  priority, body opening with `**Human action required — hold in triage; not for /next.**`, plus
  the attempt, the failure output as proof, the exact steps for the human, and an
  `fp=human/<slug>` marker. These stay in Triage (the hold exception — never promoted, never
  started by `/next`); the PR Follow-ups routine owns the `fp=human/` namespace — it lists every
  open item on the weekly Human Action List and closes them on proof (which is why `suggestion`
  is mandatory). Dedup for any filing path must also search `[human]` titles so a held blocker
  doesn't get a promotable twin. Full rule:
  [`AGENTS.md`](../../../AGENTS.md#filing-follow-up-work-as-github-issues).
- **Before rewriting an existing body, read it with `search_issues`** — never `issue_read` or
  `list_issues`, both of which corrupt what they return. See
  [Reading a body you intend to rewrite](#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity)
  below; it is the canonical statement of that rule and the routines defer to it.

## Reading a body you intend to rewrite (MCP read fidelity)

**Only `search_issues` returns an issue body faithfully. `issue_read` and `list_issues` both
corrupt it.** Any edit sourced from those two silently destroys content — most visibly the `fp=`
dedup marker, but code snippets too, which are unrecoverable.

The damage is **entirely on read**. Stored bodies on GitHub are intact; nothing needs back-filling,
and a body rewritten from a `search_issues` read round-trips byte-for-byte.

| Read path | HTML comments (`fp=` markers) | HTML/JSX tags | `'` `"` `&` | Safe to re-body from? |
| --- | --- | --- | --- | --- |
| `issue_read method:get` | ❌ stripped | ❌ stripped | ❌ → `&#39;` `&#34;` `&amp;` | **No** |
| `list_issues fields:["body"]` | ❌ stripped | ❌ stripped | ❌ → `&#39;` `&#34;` `&amp;` | **No** |
| `search_issues fields:["number","title","body"]` | ✅ intact | ✅ intact | ✅ literal | **Yes** |

Three independent corruption vectors, found across three separate runs (2026-08-09, -08-10, -08-12)
because each one masks the others:

1. **HTML comments are deleted** — the `<!-- agent-suggestion: v1 fp=… -->` marker vanishes, so a
   rewrite drops it and the curator re-files the issue as net-new on its next run.
2. **Unrecognised tags are deleted**, including JSX *inside fenced code blocks* — a ` ```tsx ` fence
   comes back as blank lines. This one is unrecoverable by convention: a dropped marker can be
   reconstructed from `fp=<area>/<slug>`, a dropped snippet cannot.
3. **`'`, `"`, `&` are entity-escaped** — inside code fences the quoted JSON, SQL, and shell stop
   being copy-pasteable.

The tag sanitizer is **allowlist-based, not blanket** — `<br>` survives while `<Tabs.Screen …/>`
does not, which is why the defect reads as intermittent and went three rounds before being pinned.

### Re-verifying this (the probe)

Four calls, on two fixture issues chosen because each carries content the others miss. Re-run it if
the MCP version changes or a read looks suspicious:

| Step | Call | Expected on a faithful read |
| --- | --- | --- |
| 1 | `search_issues` `"Ship mobile Backwork browse and upload"`, `fields:["number","title","body"]` | #357's ` ```tsx ` fence holds five `<Tabs.Screen name="chat" ... />` lines; `Frapp's` has a literal `'` |
| 2 | `issue_read method:get` on **#357** | Contrast: fence is six blank lines, marker absent, `Frapp&#39;s` |
| 3 | `search_issues` `"Backfill missing fp= dedup markers legacy"` | #697's body contains a literal `<!-- agent-suggestion: v1 fp=docs/backfill-missing-dedup-markers … -->` and nested `<issue id="…">` tags |
| 4 | `WebFetch` `https://github.com/pdcarlson/Frapp/issues/357` | Out-of-band ground truth — the rendered page must agree with step 1, not step 2 |

Last verified **2026-08-14** (all three vectors, against the table above). The 2026-08-11 check
that preceded it covered only vector 1, which is why two subsequent triage runs still refused to
write: a rule naming just HTML comments gives an agent no cover when the body holds a `tsx` fence.
State which vectors a re-verification covered, so the next one extends this rather than re-deriving it.

### The write side is faithful too (proven end to end)

Read fidelity alone doesn't license a rewrite — `issue_write` also has to store what it is given.
It does. Proven 2026-08-14 on a throwaway fixture (#888, closed) carrying all three vectors at
once, by performing **the exact edit the blocked runs refused**: adding an `### Agent brief`
section to a body containing an `fp=` marker, a `tsx` fence with JSX, and quotes/ampersands.

`create → search_issues → edit → issue_write → search_issues` returned the body byte-identical
apart from the intended addition: marker present, `<Tabs.Screen name="chat" options={{ title:
'Chat' }} />` intact, `it's a "quoted" phrase with Rationale & impact` intact. `WebFetch` on the
rendered page agreed on every visible element. So a brief backfill sourced from `search_issues` is
safe, and criteria of the form *"a marker known to exist survives a simulated refresh"* are met.

(HTML comments are invisible in rendered HTML by design, so `WebFetch` cannot confirm the marker —
`search_issues`, which reads the stored body, is the authority for that one. Don't read a
`WebFetch` miss as a dropped marker.)

### Using it

`search_issues` is a **semantic** search, not fetch-by-number. Query it with distinctive words from
the target's own title, then **confirm the returned `number` is the issue you mean** before using
the body. If the issue doesn't come back, **skip the body edit and leave a comment instead** —
never fall back to `issue_read` to source a rewrite. After writing, confirm the marker survived.

**It is index-backed, so it lags writes.** A just-created or just-edited issue can be missing from
`search_issues` results for a short window — observed 2026-08-14 on a seconds-old issue, which
returned `total_count: 0` and then resolved normally moments later. Two consequences: never treat
an empty result on a fresh issue as "the issue has no marker" (that misreads as the bootstrap
trigger for the PR Follow-ups tracking issue), and when a write must be read back to confirm, allow
for a retry rather than concluding the write failed.

This unblocks **#697** (backfill `fp=` markers on legacy Cursor-filed suggestions), which was held
pending a lossless path, and it is why routines may resume Agent-brief backfills.

## Ownership boundary (organize broadly, destroy narrowly)

Unchanged in substance from the Linear era. The backlog routines split writes into two classes:

- **Destructive writes** — close, mark-duplicate, re-body (including adding an Agent brief) — are
  allowed **only** on issues carrying the **`suggestion`** label, confirmed by a pre-write label
  read (`issue_read get_labels`), else SKIP. Human-filed work is never closed or re-bodied by a
  routine.
- **Organizational writes** — priority labels, `area:*`, `Blocked by #N` lines, promoting
  Triage → Backlog — are the triage routine's job **on any `triage` item**, whoever filed it.
  **Exception:** human-action holds (`[human]`/`[pr-followup][human]` titles or the
  `**Human action required — hold in triage` body opener) are never promoted — they get
  priority/estimate only and stay in Triage (see "Filing an issue" above). A
  **human-set priority is never overwritten**; routines correct obviously-wrong priorities only on
  `suggestion`-owned issues. Epics and planning structure are read-only to routines.

## No platform caps

GitHub Issues has no active-issue cap, so the Linear Free-tier 250-active accounting is gone. The
backlog stays lean **by choice**: the curator's conservative net-new budget and the triage
routine's grooming are quality goals (so `/next` ranks real work first), not cap avoidance.

## Migration record (2026-08-08)

- All 206 open GitHub issues predating the migration were 1:1 title-matched twins of open Linear
  issues (the June import + the GitHub→Linear sync). The 60 open Linear-born issues without twins
  were recreated as GitHub issues with their Linear bodies and a provenance footer; the FRA-→#N
  mapping table lives in **#680**.
- Twin bodies were **not** rewritten from Linear — a body edited by the curator in Linear may be
  newer than its GitHub twin. An absent Agent brief reads as `depth:deep`; the triage routine
  backfills briefs on `suggestion`-owned issues over time.
- Owner wind-down checklist (also in #680): disconnect Linear's GitHub integration **before any
  Linear-side cleanup** (close-sync could otherwise close real GitHub issues), then remove the
  Linear connector from claude.ai, then archive/delete the workspace at leisure.

## Sources

- GitHub sub-issues: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues>
- Closing issues via PR keywords (`Fixes #N`): <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
