spec/ui/web-dashboard/README.md:1 now opens: "Active (Signet). ... The #920 reskin is complete."
spec/ui/landing/README.md:1 still opens: "FROZEN (pre-Signet)."

One piece of real drift worth noting: spec/ui/README.md:36 still says the web dashboard's "per-screen-family truing-up is tracked on #920" — true when written, but that truing-up finished with slice 8.

**3. Actual rendered state of apps/web**

Booted dev server, rendered four screens in Chromium (SUPABASE_AUTH_BYPASS, no seeded chapter — empty states). Uniformly Signet. No mix, no stragglers.

Screens captured — Directory (/members), Events, Tasks, Chat. All show dark warm charcoal, house gold, Figtree, section-grouped sidebar with an accent-tinted active row.

Evidence:
- apps/web/app/globals.css is one line: @import "../../../packages/theme/src/signet.css"; — changed by 194d4d3 (slice 1). apps/landing/app/globals.css:1 still imports the legacy packages/theme/src/globals.css. One stylesheet each, exactly as designed.
- Live computed values: body background rgb(14,13,11) = #0E0D0B; font figtree; --surface-1: #171512, --accent-subtle: #2c210b, --accent-text: #ffc64a, --accent-border: #6a5220.
- Every legacy token resolves to null in the browser: --side-bg, --side-fg, --primary-50, --primary-500, --hue-1. Deleted, not overridden.
- Sidebar — apps/web/components/layout/dashboard-shell.tsx:360: bg-surface-1 border-border text-foreground. Nav rows in protected-nav-item.tsx:108-114: active is bg-accent-subtle font-semibold text-accent-text, idle is text-muted-foreground hover:bg-card hover:text-foreground.
- derivePalette is gone. Every surviving hit across apps/+packages/ is a past-tense comment. Zero call sites.

**4. Git history since Aug 21**

Plus non-#920 items: bf68251 deleted the web-visual-regression snapshot gate (#1186); 51fb6d6 fixed Can reading fetchStatus (#1211). Local clone current with origin/main.

**5. #1150**

Closed as completed, Aug 21 21:53Z — superseded, not re-landed and not still pending.

The "48 of 50" figure was one of five rejected containment strategies (constraining --side-bg-hi to preserve stock --side-muted). Headline breakage: --side-muted dropped from 3.97:1 to as low as 1.86:1, worse for all 50 chapters, 45 below AA-large.

Resolved by deletion rather than derivation. Slice 1's commit message: "the --side-* family is deleted outright... Supersedes the sidebar half of #1150 and #1164; dissolves #1149." Sidebar is now fixed --surface-1 with the chapter showing through an accent pair whose contrast the generator guarantees at generation time. Hover/active states exist today and are contrast-safe by construction.

**6. #916 and #917**

Both closed as completed Aug 23, within one minute of each other, by slice 9 / #1224.
- #917 (deprecated @repo/theme brand aliases) — closed 14:48:15Z. The three @deprecated aliases had zero consumers; the comment justifying them was false (accent.ts reads brand.bronze, not royalBlue).
- #916 (emerald scale fall-through) — closed 14:48:56Z. Its remaining live defect was on apps/landing, not apps/web — every web path #916 named was already clean.

**What's actually done vs. pending**

Done: entire apps/web reskin (shell, primitives, all 21 screen directories, 5 routes outside (dashboard)); legacy derivePalette engine and branding.colors.dark removed end to end; spec/ui/web-dashboard/ unfrozen and rewritten; #916, #917, #1150, #1202, #1204, #541, #1157 closed; responsive floor gate widened 15 → 20 routes.

Pending: #1190 and #1193 — both need a design call, not code. apps/landing untouched and still legitimately frozen; its reskin (#913/#914) gates full removal of the Tailwind scale keys. Slice 9 also filed #1218–#1223 as follow-ups, and flagged: deleting colors.dark makes an un-updated mobile binary get a 400 rather than a no-op, and check:api-breaking can't see it.