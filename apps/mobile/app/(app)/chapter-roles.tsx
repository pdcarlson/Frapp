import { Fragment, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { describeLoadFailure } from "@repo/hooks/error-copy";
import { matchesWordStarts, normalizeWords } from "@repo/hooks/fuzzy-match";
import {
  byDisplayOrder,
  isWildcardRole,
  type TieredRole,
} from "@repo/hooks/role-tiers";
import { isEveryoneRole, roleColorOrNull } from "@repo/validation";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_CHAPTER_SETTINGS } from "@/components/back-row";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { SearchField } from "@/components/filter-chips";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import { useRolesData } from "@/lib/roles/use-roles-data";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** A role list longer than this gets a search field, as web's does. */
const SEARCH_FROM = 8;

/**
 * Chapter settings → Roles on the phone (#4074): the chapter's tiers in rank
 * order, each with its roles, then the roles outside the tiers. Web's Roles
 * tab (#3990) in the grouped-list shape iOS Settings and Discord mobile's
 * Server Settings → Roles use: one section per tier, a Permissions row first
 * (what every role in it can do), then a row per role with its color and how
 * many hold it.
 *
 * Built for a chapter with a hundred roles, not five: the tiers carry the
 * permissions, so an officer changes five tiers rather than a hundred roles,
 * and a search field narrows the list once it passes eight roles. Making,
 * reordering and deleting tiers and roles stay on web, where a chapter sets
 * its structure up once; the phone changes what they can do.
 *
 * Tier names, and the word for a tier, are the chapter's own
 * (`tierWords(vocab("tier"))`), never a constant.
 */
export default function ChapterRolesScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const data = useRolesData();
  const { rolesQuery, tiersQuery, roles, tiers, memberCounts, words } = data;
  const [query, setQuery] = useState("");
  const filtering = normalizeWords(query).length > 0;

  const sections = useMemo(() => {
    const tierIds = new Set(tiers.map((tier) => tier.id));
    const inTier = (tierId: string | null) =>
      [...roles]
        .filter((role) =>
          tierId === null
            ? !(role.tier_id && tierIds.has(role.tier_id))
            : role.tier_id === tierId,
        )
        .filter((role) => !filtering || matchesWordStarts(role.name, query))
        .sort(byDisplayOrder);
    return [
      ...tiers.map((tier) => ({
        key: tier.id,
        tier,
        title: tier.name,
        roles: inTier(tier.id),
      })),
      {
        key: "outside",
        tier: null,
        title: `Outside the ${words.plural}`,
        roles: inTier(null),
      },
    ];
  }, [roles, tiers, filtering, query, words.plural]);

  const loaded = rolesQuery.isSuccess && tiersQuery.isSuccess;
  const subtitle = loaded
    ? `${roles.length} ${roles.length === 1 ? "role" : "roles"} in ${tiers.length} ${tiers.length === 1 ? words.singular : words.plural}`
    : undefined;

  const openRole = (role: TieredRole) =>
    router.push({ pathname: "/role", params: { roleId: role.id } });

  let body: React.ReactNode;
  if (rolesQuery.isError || tiersQuery.isError) {
    body = (
      <ErrorState
        title="Couldn't load roles"
        body={describeLoadFailure(rolesQuery.error ?? tiersQuery.error)}
        onRetry={() => {
          void rolesQuery.refetch();
          void tiersQuery.refetch();
        }}
        isRetrying={rolesQuery.isFetching || tiersQuery.isFetching}
      />
    );
  } else if (!loaded) {
    body = (
      <SkeletonRegion label="Loading roles" style={styles.skeleton}>
        {[0, 1].map((section) => (
          <ListSection key={section}>
            {[0, 1, 2].map((index) => (
              <ListRowSkeleton key={index} index={section + index} />
            ))}
          </ListSection>
        ))}
      </SkeletonRegion>
    );
  } else {
    const shown = sections.filter(
      (section) =>
        section.roles.length > 0 || (!filtering && section.tier !== null),
    );
    body = (
      <>
        {roles.length > SEARCH_FROM ? (
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Find a role"
            accessibilityLabel="Find a role"
          />
        ) : null}
        {filtering && shown.length === 0 ? (
          <Text style={styles.note}>No role matches “{query.trim()}”.</Text>
        ) : null}
        {shown.map((section) => (
          <Fragment key={section.key}>
            <SectionHeader count={section.roles.length}>
              {section.title}
            </SectionHeader>
            <ListSection>
              {section.tier && !filtering ? (
                <ListRow
                  label="Permissions"
                  value={`${section.tier.permissions.length} on`}
                  accessibilityHint={`Opens what every role in ${section.tier.name} can do.`}
                  onPress={() =>
                    router.push({
                      pathname: "/role-tier",
                      params: { tierId: section.tier!.id },
                    })
                  }
                />
              ) : null}
              {section.tier && !filtering && section.roles.length === 0 ? (
                <ListRow
                  label={`No roles in this ${words.singular} yet`}
                  variant="detail"
                />
              ) : null}
              {section.roles.map((role) => {
                // 0 once the members read lands; nothing before it, so a row
                // never claims "0" for a role that may well have members.
                const count =
                  memberCounts?.get(role.id) ?? (memberCounts ? 0 : null);
                const color = roleColorOrNull(role.color);
                return (
                  <ListRow
                    key={role.id}
                    label={role.name}
                    leading={
                      <View
                        style={[
                          styles.dot,
                          color ? { backgroundColor: color } : null,
                        ]}
                      />
                    }
                    // The same notes web's Roles list puts beside a name.
                    description={
                      isWildcardRole(role)
                        ? "Can do everything"
                        : isEveryoneRole(role)
                          ? "Pinged as @everyone"
                          : null
                    }
                    value={count === null ? null : String(count)}
                    accessibilityValue={
                      count === null
                        ? undefined
                        : `${count} ${count === 1 ? "member" : "members"}`
                    }
                    accessibilityHint="Opens what this role can do."
                    onPress={() => openRole(role)}
                  />
                );
              })}
            </ListSection>
          </Fragment>
        ))}
        <Text style={styles.note}>
          Add, rename and reorder {words.plural} and roles on the web
          dashboard.
        </Text>
      </>
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_CHAPTER_SETTINGS}
      title="Roles"
      subtitle={subtitle}
      refresh={() => Promise.all([rolesQuery.refetch(), tiersQuery.refetch()])}
    >
      {body}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    skeleton: { gap: tokens.spacing.lg },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
    },
    note: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
