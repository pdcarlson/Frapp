import { useState } from "react";
import { errorCopy, useSetPickedRole, type PickableRole } from "@repo/hooks";
import { ListRow, ListSection } from "@/components/list-section";
import { Toggle } from "@/components/toggle";

/**
 * Under a role the member holds but can't join again: one an officer stopped
 * offering, or any picked role once they're an alum. Leaving still works.
 */
export const LEAVE_ONLY_CAPTION = "No longer open to join. You can leave it.";

/** The picker's one line of copy, shared by the sheet and s03's roles beat. */
export const PICK_ROLES_LEDE =
  "Pick what you're into. Each role adds its channels to Chat, and you can leave any time.";

/**
 * One switch per pickable role (#4958), each saved on the tap; a failed save
 * says why under its row. The Add roles sheet and s03's `Pick your roles`
 * beat both draw it.
 */
export function PickRolesList({ roles }: { roles: readonly PickableRole[] }) {
  const setPicked = useSetPickedRole();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    id: string;
    message: string;
  } | null>(null);

  async function toggle(role: PickableRole) {
    setPendingId(role.id);
    setFailure(null);
    try {
      await setPicked.mutateAsync({ id: role.id, join: !role.held });
    } catch (error) {
      setFailure({ id: role.id, message: errorCopy(error) });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <ListSection>
      {roles.map((role) => {
        const failed = failure?.id === role.id ? failure.message : null;
        const caption = failed ?? (role.joinable ? null : LEAVE_ONLY_CAPTION);
        return (
          <ListRow
            key={role.id}
            label={role.name}
            description={caption}
            descriptionTone={failed ? "destructive" : "default"}
            trailing={
              <Toggle
                value={role.held}
                disabled={pendingId !== null}
                onValueChange={() => void toggle(role)}
                accessibilityLabel={
                  role.held ? `Leave ${role.name}` : `Join ${role.name}`
                }
              />
            }
          />
        );
      })}
    </ListSection>
  );
}
