# Restructuring Signet's event-creation modal: reference patterns and a concrete redesign

**The strongest creation modals converge on one shape: a short "above-the-fold" tier of the 3–5 fields nearly every object needs, everything else collapsed behind an explicit "More options" expansion, aggressive smart defaults so most fields are never touched, many-option pickers rendered as searchable command-popovers with removable chips (never raw checkbox lists), and inline validation that fires on blur-after-first-touch rather than on submit.** For Signet, this means keeping the current single Radix Dialog (not a wizard — the fields are interdependent, which NN/g specifically warns against splitting [nngroup](https://www.nngroup.com/articles/progressive-disclosure/) ), but restructuring it into a **primary section (name, start/end, location, attendance, recurrence) + a collapsed "More options" section (points, description, internal notes, role targeting)**, replacing the unbounded role checkbox list with a **multi-select command-combobox defaulting to "Everyone,"** wiring the already-available `@repo/validation` Zod schema through React Hook Form with **`mode: 'onTouched'`**, and rendering field-level errors via ShadCN's `FormMessage` instead of post-submit toasts. Concrete spec is at the end.

## How the reference products handle each dimension

| Product | Default/above-fold tier | Progressive disclosure | Many-option selection |
|---|---|---|---|
| **Google Calendar** | Quick-create popup = **title + time only**  | "More options" opens full editor: guests, description, location, conferencing, visibility, repeat [york](https://subjectguides.york.ac.uk/google/calendar) | Recurrence via "Does not repeat" dropdown → "Custom…" dialog [nocal](https://nocal.app/help/google-calendar/custom-recurring-events) |
| **Linear** | Only **title + status are required**; all else optional [linear](https://linear.app/docs/creating-issues) | Distinct entry points: `C` = compact modal, `V` = full-screen editor [linear](https://linear.app/docs/creating-issues) | Searchable command menu (`⌘K` "Assign to…"), keyboard-first pickers, not checkbox lists [linear](https://linear.app/docs/assigning-issues) |
| **Notion** | Peek preview first; pinned properties near title [notion](https://www.notion.com/help/intro-to-databases) | Full page mode shows all properties; "Customize page" controls what's above-fold [notion](https://www.notion.com/help/intro-to-databases) | Property templates prefill values (e.g. auto-set Priority=P1, assignee) [notion](https://www.notion.com/help/database-templates) |
| **Fantastical** | Single NL text box parses title + datetime instantly [flexibits](https://flexibits.com/fantastical-ios/help/adding-events-and-tasks) | "Show Details" reveals location and other fields [flexibits](https://flexibits.com/fantastical-ios/help/adding-events-and-tasks) | `with`/`at`/`/` tokens route invitees, location, calendar via typeahead [flexibits](https://flexibits.com/fantastical-ios/help/adding-events-and-tasks) |
| **Cal.com / Calendly** | Base "Event setup" tab loads first [cal](https://cal.com/faq) | Config split across tabs: Basics, Availability, Limits, **Advanced**, Recurring, Apps, Workflows [cal](https://cal.com/blog/event-types-guide-calcom) ; Calendly hides extras behind "More options" [calendly](https://calendly.com/help/event-type-editor-overview) |  — |

### 1. Grouping, order, and progressive disclosure
The dominant pattern is a **two-tier split, not a wizard**. Google Calendar's quick-create surfaces only **title + time**, with everything else — guests, description, location, visibility, repeat — behind "More options"  [york](https://subjectguides.york.ac.uk/google/calendar) . Linear reduces the *required* surface to just title + status [linear](https://linear.app/docs/creating-issues) . NN/g's rule for the split: the initial tier must hold what users *frequently* need, the secondary tier must not be overloaded, and the expansion control must carry clear "information scent" about what's inside [nngroup](https://www.nngroup.com/articles/progressive-disclosure/) . Critically for Signet, NN/g distinguishes progressive disclosure (fine for one modal) from **staged/wizard disclosure, which is "problematic when steps are interdependent"** [nngroup](https://www.nngroup.com/articles/progressive-disclosure/) — event fields (end depends on start, recurrence interacts with dates) are interdependent, so a stepped wizard is the wrong tool here despite the current modal's length. Cal.com uses **tabs** (not one flat scroll) for its genuinely large config surface [cal](https://cal.com/blog/event-types-guide-calcom) , but Signet's ~9 fields don't warrant tabs — a single collapse section is enough.

### 2. Required vs optional distinction
Both NN/g and Baymard are unambiguous: **mark required fields explicitly** (implicit requirements cause inference errors), and Baymard's testing found **32% of users hit a validation error when only optional fields were marked** [baymard](https://baymard.com/blog/required-optional-form-fields) . Their recommendation for mixed forms is to mark **both** — required with an asterisk, optional with "(optional)" [baymard](https://baymard.com/blog/required-optional-form-fields) . NN/g adds that red is the familiar required-marker color but avoid low-contrast markers [nngroup](https://www.nngroup.com/articles/required-fields/) . Linear's approach — keeping the required set tiny (title + status) so almost nothing *needs* marking — is itself the cleanest solution [linear](https://linear.app/docs/creating-issues) .

### 3. Validation surfacing
The consensus timing is **"reward early, punish late"**: validate a field when the user *leaves* it (`onblur`), not while they type [smashing](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/) [baymard](https://baymard.com/blog/inline-form-validation) . NN/g calls premature (while-typing) errors a "hostile pattern" that feels like scolding [nngroup](https://www.nngroup.com/articles/hostile-error-messages/) . Once a field is in an error state, re-check on keystroke and clear the error the moment it becomes valid [baymard](https://baymard.com/blog/inline-form-validation) . Error styling: message **adjacent to the field, red, with an icon** (icons matter for colorblind users) [nngroup](https://www.nngroup.com/articles/errors-forms-design-guidelines/) ; GOV.UK pairs an inline red-bordered message with an **error summary** when multiple errors exist [govuk](https://design-system.service.gov.uk/components/error-message/) . Signet's current toast-only-on-submit approach is the specific anti-pattern all of these sources reject.

On **disabling submit until valid**: Smashing argues *against* it — disabled buttons "don't explain what's wrong," inline validation is "never bulletproof," and users get locked out with no clue [smashing](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/) . The recommended alternative is to keep submit **always enabled**, validate on click, then focus/summarize the errors. So Signet should *not* disable-until-valid (contradicting the naive fix); it should show inline errors on blur and again on submit.

### 4. Selecting from many options without a checkbox list
No strong reference uses an unbounded checkbox list. Linear uses a **searchable command menu** for assignment/labels [linear](https://linear.app/docs/assigning-issues) and enforces **one-label-per-group** to cap combinatorial explosion [linear](https://linear.app/docs/labels) . Google Calendar collapses recurrence into a **dropdown of presets → a focused "Custom" dialog** with day-toggle buttons and an "Ends" condition, rather than exposing all recurrence controls at once [nocal](https://nocal.app/help/google-calendar/custom-recurring-events) . Fantastical uses **token typeahead** (`with`, `at`) [flexibits](https://flexibits.com/fantastical-ios/help/adding-events-and-tasks) . The implementable equivalent for Signet's role targeting is the standard ShadCN **multi-select combobox**: `Popover` + `Command` (cmdk) with `CommandInput` search, checkable `CommandItem`s, a **"Select all"/Everyone** item separated by `CommandSeparator`, and **selected roles rendered as removable `Badge` chips** in the trigger [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-2) [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-1) . (The mxkaske "Fancy Multi Select" and Emblor tag-input are drop-in references if a from-scratch build is wanted [github](https://github.com/mxkaske/mxkaske.dev/blob/main/components/craft/fancy-multi-select.tsx) .)

### 5. Create vs edit mode
Linear uses **distinct entry points and state** — `C` for the create modal (with an auto-saved "temporary draft"), `V`/full-screen for editing [linear](https://linear.app/docs/creating-issues) . Notion signals view-vs-edit via **peek-preview then full-page** and "click the value to edit" [notion](https://www.notion.com/help/intro-to-databases) . The practical convention: change the `DialogTitle` ("Create event" vs "Edit event") and the primary button label ("Create event" vs "Save changes"), prefill defaults in create mode and load existing values in edit mode, and reset form state on close.

### 6. Smart defaults that reduce fields touched
This is where the references save the most user effort. Google Calendar **infers end time from a default duration** (recommended 30 min)  and defaults recurrence to "Does not repeat" [nocal](https://nocal.app/help/google-calendar/custom-recurring-events) . Notion/Linear templates **prefill properties** (Priority=P1, assignee) so the row is created with one action [notion](https://www.notion.com/help/database-templates) [linear](https://linear.app/docs/issue-templates) ; Linear applies a **default status** to new issues, overridable at creation [linear](https://linear.app/docs/configuring-workflows) . NN/g's EAS framework endorses defaults but warns **users rarely change them**, so a bad default becomes a silent error [nngroup](https://www.nngroup.com/articles/eas-framework-simplify-forms/) ; Smashing says only set a generic default if **~90%** of users would pick it [smashing](https://www.smashingmagazine.com/2017/06/designing-efficient-web-forms/) . Signet's existing `pointValue: 10` default is exactly this pattern — extend it to end-time, recurrence, attendance, and role targeting.

---

## Concrete restructured modal for Signet's exact field set

**Format decision: one Radix Dialog, two visual tiers, no wizard.** The nine fields are interdependent and event creation is a repeated officer task, so keep a single scrollable dialog but section it. Replace the 423-line flat scroll with a **primary block always visible** and a **collapsed ShadCN `Collapsible`/`Accordion` "More options" block** [shadcn](https://ui.shadcn.com/docs/components/accordion) . Standardize *every* control to ShadCN/Radix — remove the bare native `<select>`/`<textarea>`.

### Layout

**Tier 1 — always visible (the fields nearly every event needs):**
1. **Event name** — `Input`, required (marked `*`).
2. **Start** and **End** — two datetime controls side by side, both required. **Smart default: End = Start + 1 hour**, recomputed whenever Start changes and End hasn't been manually edited.
3. **Location** — `Input`, optional (labeled "(optional)").
4. **Attendance policy** — a **segmented control / `ToggleGroup`** (Mandatory | Optional), not a dropdown. Default: **Optional** (the non-coercive default).
5. **Recurrence** — `Select` defaulting to **"Does not repeat"** (rename "one-time"), mirroring Google Calendar's compact dropdown [nocal](https://nocal.app/help/google-calendar/custom-recurring-events) . Options: Does not repeat / Weekly / Biweekly / Monthly.

**Tier 2 — collapsed under "More options" (advanced/defaulted fields most creators never touch):**
6. **Applies to (role targeting)** — the redesigned multi-select (below). **Default: "Everyone."**
7. **Point value** — `Input type=number`, default **10** (existing).
8. **Description** — `Textarea`, optional.
9. **Internal notes** — `Textarea`, optional, with a small "visible to officers only" helper.

Label the expander clearly ("More options — points, description, roles") to satisfy NN/g's information-scent requirement [nngroup](https://www.nngroup.com/articles/progressive-disclosure/) . Because every Tier 2 field is optional or defaulted, a user can create a valid event touching only name + start (end auto-fills).

### Role-targeting control (replaces the unbounded checkbox list)

Build a **multi-select command-combobox**, not a checkbox column:
- Trigger button shows selected roles as removable `Badge` chips; empty/default state shows a single **"Everyone" chip** [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-1) .
- Clicking opens a `Popover` containing `Command` → `CommandInput` (type to filter roles) → `CommandList` of checkable `CommandItem`s [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-2) .
- Top item **"Everyone (all roles)"**, separated by `CommandSeparator`, toggles all on/off (the shadcn "Select all" pattern) [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-2) . Selecting Everyone clears individual selections and stores a sentinel (e.g. empty array = all).
- On the badge's `X`, call `stopPropagation` so removing a chip doesn't toggle the popover [shadcn](https://www.shadcn.io/patterns/combobox-multi-select-1) .
- If chapter roles have categories, use `CommandGroup` headers. This scales to any role count without vertical growth of the modal.

### Validation (React Hook Form + Zod via `@repo/validation`)

Wire the currently-unused `@repo/validation` schema through `zodResolver`, and configure timing to match "reward early, punish late":

```
useForm({
  resolver: zodResolver(eventSchema),
  mode: 'onTouched',        // validate on first blur, then live per keystroke
  reValidateMode: 'onChange',
  defaultValues: { pointValue: 10, recurrence: 'none', attendance: 'optional', roles: [], end: <start+1h> }
})
```
`mode: 'onTouched'` triggers validation on a field's first blur and live thereafter — exactly the recommended blur-then-live behavior [reacthookform](https://react-hook-form.com/docs/useform) [smashing](https://www.smashingmagazine.com/2022/09/inline-validation-web-forms-ux/) . Render each field with ShadCN `FormField → FormItem → FormLabel → FormControl → FormMessage`, where **`FormMessage` shows the field-level error inline** (red, adjacent) — replacing toasts [shadcn](https://ui.shadcn.com/docs/forms/react-hook-form) [nngroup](https://www.nngroup.com/articles/errors-forms-design-guidelines/) . For custom controls (datetime pickers, the roles combobox) wire `onBlur` through `Controller`, or RHF's touched/blur validation won't fire [reacthookform](https://react-hook-form.com/docs/useform) .

**Keep the submit button always enabled** (do not disable-until-valid); on submit, RHF focuses the first invalid field, and reserve toasts only for *server* errors [smashing](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/) .

**Per-field rules for the Zod schema:**

| Field | Rule | Error timing |
|---|---|---|
| Event name | `z.string().min(1, 'Name is required')` | On blur |
| Start | required valid datetime | On blur |
| End | required; **`end > start`** via object-level `.superRefine(...)` with `ctx.addIssue({ path: ['end'], message: 'End must be after start' })` [zod](https://v3.zod.dev/?id=superrefine) | On blur / when start changes |
| Location | `z.string().optional()` | none |
| Attendance | `z.enum(['mandatory','optional'])`, default `optional` | none (defaulted) |
| Recurrence | `z.enum(['none','weekly','biweekly','monthly'])`, default `none` | none |
| Roles | `z.array(z.string())` — empty = Everyone (valid); no min-length error | none |
| Point value | `z.coerce.number().min(0)`, default 10 | On blur if edited |
| Description / Internal notes | `z.string().optional()` | none |

Use `.superRefine` (not `.refine`) so the end-before-start error attaches to the End field specifically and can coexist with other issues [zod](https://v3.zod.dev/?id=superrefine) . If recurrence later gains a required end-date, add a conditional `superRefine` branch (`if recurrence !== 'none' && !recurrenceEnd → addIssue`) — the documented conditional-required pattern [github](https://github.com/colinhacks/zod/discussions/938) .

### Create vs edit mode
Drive one component with an `event?` prop. `DialogTitle` = "Create event" / "Edit event"; primary button = "Create event" / "Save changes"; `defaultValues` = the smart-default object (create) or the loaded event (edit). Close the dialog on successful submit via `setOpen(false)` and `event.preventDefault()` (Radix's documented async-submit pattern) [radix](https://www.radix-ui.com/primitives/docs/components/dialog) , and **reset the form on close** via a `useEffect` on the `open` prop so drafts don't leak between opens [stackoverflow](https://stackoverflow.com/questions/77014446/shadcn-dialog-does-not-close-on-submit-button) . Note a known gotcha: with `mode: 'all'`, a shadcn Dialog can require two close clicks when errors are present — `onTouched` avoids this [github](https://github.com/shadcn-ui/ui/issues/3843) .

### Net effect on user effort
With these defaults, the minimum viable create action is **name + start** (end, attendance, recurrence, roles, points all pre-filled) — matching Google Calendar's title+time floor  and Linear's title+status floor [linear](https://linear.app/docs/creating-issues) . The four fields most likely to be defaulted (points, roles, recurrence, attendance) are either invisible until "More options" or set to the ~90%-case value, satisfying the smart-defaults evidence while keeping every default overridable and visible [nngroup](https://www.nngroup.com/articles/eas-framework-simplify-forms/) .

---

**Where more research would change the recommendation:** (1) The exact composition of Signet's chapter-role set — if roles are few (≤5) and rarely change, a compact `ToggleGroup`/chip row may beat the command-combobox; if they're numerous or categorized, the combobox is clearly right. Confirming the real role count and whether "target a subset" is even a common action would validate whether role-targeting belongs in Tier 2 at all. (2) Whether officers frequently create *recurring* events with end conditions — if so, adopting Google Calendar's full "Custom recurrence" sub-dialog (interval + weekday toggles + Ends) becomes worthwhile [nocal](https://nocal.app/help/google-calendar/custom-recurring-events) , which would add conditional required-field validation not present in the current flat field set.