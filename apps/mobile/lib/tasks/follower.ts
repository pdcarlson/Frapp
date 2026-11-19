/**
 * The task form's From on the phone (#5473, `spec/behavior/tasks.md`
 * § Following a task): "Just you", or a tier, role or group the officer is
 * in, whose members can then see the task and how it's going. The choices
 * are shared with web (`followerChoices` in `@repo/hooks`); only their shape
 * as a pick-one sheet is the phone's own, kept here where it is unit-tested.
 */

import {
  FOLLOWER_HEADINGS,
  type FollowerChoice,
} from "@repo/hooks/task-follower-choices";
import {
  TASK_FOLLOWER_COPY,
  parseTaskFollower,
  type TaskFollowerKind,
} from "@repo/validation";

/** One row of the From sheet, in the shape the pick-one sheet takes. */
export interface FollowerOption {
  /** The entry, or `null` for "Just you". */
  value: string | null;
  label: string;
  accessibilityLabel?: string;
  /** Tiers, Roles or Groups, on the first row of each. */
  heading?: string;
}

const KINDS: readonly TaskFollowerKind[] = ["tier", "role", "group"];

/**
 * The choices with the task's own follower kept in, by the name its read
 * carries, when the officer isn't in it (an edit by another officer, or a
 * group deleted since): picking something else is a change, never a loss
 * on opening.
 */
export function listedFollowers(
  choices: readonly FollowerChoice[],
  value: string | null,
  currentName: string | null = null,
): FollowerChoice[] {
  if (!value || choices.some((choice) => choice.entry === value)) {
    return [...choices];
  }
  const parsed = parseTaskFollower(value);
  if (!parsed) return [...choices];
  return [
    ...choices,
    {
      entry: value,
      kind: parsed.kind,
      name: currentName?.trim() || TASK_FOLLOWER_COPY.deleted,
      count: 0,
    },
  ];
}

/**
 * The sheet's rows: "Just you", then each kind under its heading (Tiers,
 * Roles, Groups), each with how many it reaches ("Exec board · 4"), as web's
 * select lists them.
 */
export function followerOptions(
  choices: readonly FollowerChoice[],
  value: string | null,
  currentName: string | null = null,
): FollowerOption[] {
  const listed = listedFollowers(choices, value, currentName);
  const options: FollowerOption[] = [
    { value: null, label: TASK_FOLLOWER_COPY.justYou },
  ];
  for (const kind of KINDS) {
    listed
      .filter((choice) => choice.kind === kind)
      .forEach((choice, index) => {
        options.push({
          value: choice.entry,
          label:
            choice.count > 0 ? `${choice.name} · ${choice.count}` : choice.name,
          accessibilityLabel:
            choice.count > 0
              ? `${choice.name}, ${choice.count} ${choice.count === 1 ? "person" : "people"}`
              : choice.name,
          ...(index === 0 ? { heading: FOLLOWER_HEADINGS[kind] } : {}),
        });
      });
  }
  return options;
}

/** What the From row says: "Just you", or the follower's name. */
export function followerLabel(
  choices: readonly FollowerChoice[],
  value: string | null,
  currentName: string | null = null,
): string {
  if (!value) return TASK_FOLLOWER_COPY.justYou;
  return (
    listedFollowers(choices, value, currentName).find(
      (choice) => choice.entry === value,
    )?.name ?? TASK_FOLLOWER_COPY.deleted
  );
}
