import { useState } from "react";
import { errorCopy, useSetPickedRole, type PickableRole } from "@repo/hooks";
import { PICK_ROLES_COPY } from "@repo/validation";
import { ListRow, ListSection } from "@/components/list-section";
import { Toggle } from "@/components/toggle";

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
        const caption =
          failed ?? (role.joinable ? null : PICK_ROLES_COPY.leaveOnly);
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
