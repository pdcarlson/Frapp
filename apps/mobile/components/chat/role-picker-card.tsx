import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  ROLE_PICKER_CLOSED_CAPTION,
  rolePickerRows,
  type RolePickerPayload,
} from "@repo/chat-core/role-pickers";
import { usePickableRoles, useRoles, useSetPickedRole } from "@repo/hooks";
import { parseChapterRoles } from "@repo/hooks/chapter-roles";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { RolePickerGlyph } from "./card-glyphs";
import {
  CardButton,
  CardEyebrow,
  CardNote,
  CardTitle,
  ChatCardShell,
  type ChatCardFrameProps,
} from "./chat-card";
import { useCardWrite } from "./use-card-write";

/**
 * The role picker card on the phone (#4958), web's
 * `apps/web/components/chat/renderers/role-picker-card.tsx`: an officer's
 * list of Non-chapter business roles with a Join or Leave button beside
 * each, as Discord's button-role bots (Carl-bot) and Slack's interactive
 * messages hand out interest roles.
 *
 * The card stores nothing per member. Each row is this viewer's, from
 * `rolePickerRows` over `usePickableRoles` (what they hold and may join) and
 * the chapter's roles (a role deleted since the card was posted is left out),
 * and a tap is the Add roles sheet's own write (`useSetPickedRole`), which
 * reads the viewer's roles and channels again.
 *
 * One tap at a time: every button waits while a write is out, and a refusal
 * is a line under its own row (`useCardWrite`, which also disables the
 * buttons while a write would be lost offline or the card isn't acked yet).
 */
export function RolePickerCard({
  payload,
  ...frame
}: ChatCardFrameProps & { payload: RolePickerPayload }) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const pickable = usePickableRoles();
  const rolesQuery = useRoles();
  const chapterRoles = useMemo(
    () => parseChapterRoles(rolesQuery.data),
    [rolesQuery.data],
  );
  const rows = useMemo(
    () => rolePickerRows(payload, pickable.roles, chapterRoles),
    [payload, pickable.roles, chapterRoles],
  );
  const setPicked = useSetPickedRole();
  const { refusal, act, disabled, hint } = useCardWrite({
    gateRefusal: () => null,
    isConfirmed: frame.isConfirmed,
    pending: setPicked.isPending,
  });
  // The row the last tap was on, which its refusal line sits under.
  const [tappedId, setTappedId] = useState<string | null>(null);

  const pick = (id: string, name: string, join: boolean) => {
    setTappedId(id);
    void act(
      () => setPicked.mutateAsync({ id, join }),
      join ? `Couldn't join ${name}.` : `Couldn't leave ${name}.`,
    );
  };

  let body;
  // Until the viewer's own roles are read, every role would read as one to
  // join, so the card waits rather than offer the wrong button.
  const heldUnknown = !pickable.heldKnown;
  if (
    (pickable.isLoading && rows.length === 0) ||
    (heldUnknown && !pickable.isError)
  ) {
    body = <CardNote text="Loading roles…" />;
  } else if (pickable.isError && (rows.length === 0 || heldUnknown)) {
    body = (
      <>
        <CardNote text="Couldn't load these roles." tone="error" />
        <View style={styles.retry}>
          <CardButton label="Try again" onPress={pickable.refetch} />
        </View>
      </>
    );
  } else if (rows.length === 0) {
    body = <CardNote text="These roles are gone." />;
  } else {
    body = (
      <View style={styles.rows}>
        {rows.map((row) => (
          <View key={row.id}>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {row.name}
                </Text>
                {row.action === "closed" ? (
                  <Text style={styles.rowCaption}>
                    {ROLE_PICKER_CLOSED_CAPTION}
                  </Text>
                ) : null}
              </View>
              {row.action === "closed" ? null : (
                <CardButton
                  label={row.action === "join" ? "Join" : "Leave"}
                  accessibilityLabel={`${row.action === "join" ? "Join" : "Leave"} ${row.name}`}
                  variant={row.action === "join" ? "primary" : "secondary"}
                  disabled={disabled}
                  accessibilityHint={hint}
                  onPress={() => pick(row.id, row.name, row.action === "join")}
                />
              )}
            </View>
            {refusal && tappedId === row.id ? (
              <CardNote text={refusal.text} tone="error" />
            ) : null}
          </View>
        ))}
      </View>
    );
  }

  return (
    <ChatCardShell
      {...frame}
      header={
        <>
          <CardEyebrow label="Role picker" glyph={RolePickerGlyph} />
          <CardTitle>{payload.title}</CardTitle>
        </>
      }
    >
      {body}
    </ChatCardShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rows: {
      marginTop: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: 44,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowName: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    rowCaption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    retry: {
      marginTop: tokens.spacing.sm,
      flexDirection: "row",
    },
  });
}
