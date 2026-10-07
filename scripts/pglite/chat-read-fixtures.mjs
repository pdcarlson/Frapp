// The rows `tiers/chat-read-enforcement.mjs` seeds, and the scenarios it and
// `tiers/chat-black-box.mjs` read them back with.

export const F = {
  chapA: "aaaaaaaa-0000-0000-0000-000000000001",
  chapB: "bbbbbbbb-0000-0000-0000-000000000001",
  userAId: "aaaa1111-0000-0000-0000-000000000001", // chapter A member, holds chat:secret
  userAAuth: "aaaa2222-0000-0000-0000-000000000001",
  userBId: "bbbb1111-0000-0000-0000-000000000001", // chapter B member (other tenant)
  userBAuth: "bbbb2222-0000-0000-0000-000000000001",
  userCId: "cccc1111-0000-0000-0000-000000000001", // chapter A member, no privileges / not in DMs
  userCAuth: "cccc2222-0000-0000-0000-000000000001",
  userDId: "dddd1111-0000-0000-0000-000000000001", // chapter A member, holds '*' wildcard only
  userDAuth: "dddd2222-0000-0000-0000-000000000001",
  // Chapter A member carrying a chapter-B role id in members.role_ids. That column
  // is an unconstrained text[], so a stale/cross-chapter id is a real possibility;
  // the predicate must re-scope roles by chapter_id or this user gets chapter B's
  // permissions inside chapter A.
  userEId: "eeee1111-0000-0000-0000-000000000001",
  userEAuth: "eeee2222-0000-0000-0000-000000000001",
  // Chapter A member whose stored role id is the correct role, UPPERCASED. The
  // API takes role ids as z.string().uuid(), which accepts uppercase, so this is
  // reachable through a normal PATCH of member roles.
  userFId: "ffff1111-0000-0000-0000-000000000001",
  userFAuth: "ffff2222-0000-0000-0000-000000000001",
  roleSecret: "0e0e0e0e-0000-0000-0000-000000000001", // chapter A, permission chat:secret
  roleBasic: "0b0b0b0b-0000-0000-0000-000000000001", // chapter A, no permissions
  roleWildcard: "0a0a0a0a-0000-0000-0000-000000000001", // chapter A, permission '*'
  roleSecretChapB: "0c0c0c0c-0000-0000-0000-000000000001", // chapter B, permission chat:secret
  chPublic: "c0000001-0000-0000-0000-000000000001",
  chPrivate: "c0000002-0000-0000-0000-000000000001",
  chDM: "c0000003-0000-0000-0000-000000000001",
  chRoleGated: "c0000004-0000-0000-0000-000000000001",
  chRoleGatedOpen: "c0000005-0000-0000-0000-000000000001",
  chGroupDM: "c0000006-0000-0000-0000-000000000001",
  // Chapter B's own PUBLIC channel. Exists so the cross-chapter reader has
  // something it legitimately CAN see: without it, "userB sees zero chapter-A
  // rows" is satisfied just as well by a uuid the schema has never heard of,
  // and proves nothing about tenant scoping.
  chPublicB: "c0000007-0000-0000-0000-000000000001",
  msgPublic: "10000001-0000-0000-0000-000000000001",
  msgPrivate: "10000002-0000-0000-0000-000000000001",
  msgDM: "10000003-0000-0000-0000-000000000001",
  msgRoleGated: "10000004-0000-0000-0000-000000000001",
  msgRoleGatedOpen: "10000005-0000-0000-0000-000000000001",
  msgGroupDM: "10000006-0000-0000-0000-000000000001",
  msgPublicB: "10000007-0000-0000-0000-000000000001",
  // One invoice per chapter, so the default-deny tier in `tiers/chat-black-box.mjs` has both a
  // same-chapter row (the one a naive "scope by tenant" policy would expose)
  // and a cross-chapter row to deny.
  invA: "20000001-0000-0000-0000-000000000001",
  invB: "20000002-0000-0000-0000-000000000001",
};

export const READ_SCENARIOS = [
  { name: "own-chapter PUBLIC is visible to a chapter member", uid: F.userAAuth, msg: F.msgPublic, expect: true },
  { name: "cross-chapter PUBLIC is denied (tenant boundary)", uid: F.userBAuth, msg: F.msgPublic, expect: false },
  { name: "PRIVATE is denied to a chapter member not in member_ids", uid: F.userCAuth, msg: F.msgPrivate, expect: false },
  { name: "PRIVATE is visible to a member listed in member_ids", uid: F.userAAuth, msg: F.msgPrivate, expect: true },
  { name: "DM is visible to a participant listed in member_ids", uid: F.userAAuth, msg: F.msgDM, expect: true },
  { name: "DM is denied to a non-participant", uid: F.userCAuth, msg: F.msgDM, expect: false },
  { name: "GROUP_DM is visible to a member listed in member_ids", uid: F.userAAuth, msg: F.msgGroupDM, expect: true },
  { name: "GROUP_DM is denied to a chapter member not in member_ids", uid: F.userCAuth, msg: F.msgGroupDM, expect: false },
  { name: "ROLE_GATED is denied without the required permission", uid: F.userCAuth, msg: F.msgRoleGated, expect: false },
  { name: "ROLE_GATED is visible with the required permission", uid: F.userAAuth, msg: F.msgRoleGated, expect: true },
  { name: "ROLE_GATED is visible to a '*' wildcard holder lacking the specific permission", uid: F.userDAuth, msg: F.msgRoleGated, expect: true },
  // FRA-321: this asserted `true` — a ROLE_GATED channel that gates on nothing
  // was visible to every chapter member, i.e. functionally PUBLIC. Both the SQL
  // predicate and canAccessChannel now deny it; the backfill guarantees no
  // existing row is in that shape and the API rejects creating one.
  { name: "ROLE_GATED with empty required_permissions is denied (no longer falls open)", uid: F.userCAuth, msg: F.msgRoleGatedOpen, expect: false },
  // ...but the wildcard still wins, exactly as canAccessChannel has it. Spelling
  // the deny as a length test placed *before* the wildcard branch would deny a
  // President here and silently re-introduce SQL/TypeScript drift.
  { name: "ROLE_GATED with empty required_permissions still admits a '*' wildcard holder", uid: F.userDAuth, msg: F.msgRoleGatedOpen, expect: true },
  { name: "ROLE_GATED denies a chapter-B role id held by a chapter-A member (roles re-scoped by chapter)", uid: F.userEAuth, msg: F.msgRoleGated, expect: false },
  { name: "ROLE_GATED matches an UPPERCASE stored role id (uuid compare, not text)", uid: F.userFAuth, msg: F.msgRoleGated, expect: true },
  { name: "NULL auth.uid() (anon / no JWT) is denied", uid: null, msg: F.msgPublic, expect: false },
];
