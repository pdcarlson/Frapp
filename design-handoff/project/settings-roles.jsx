/* Settings · Roles — role pack chooser + per-role permission matrix + custom roles. */

const { useState: useStateR } = React;

const PERMISSION_GROUPS = [
  { group: "Chapter",  perms: [
    { key: "chapter.manage",   label: "Manage chapter settings" },
    { key: "members.invite",   label: "Invite members" },
    { key: "members.role.assign", label: "Assign roles" },
  ]},
  { group: "Events",   perms: [
    { key: "events.create",    label: "Create events" },
    { key: "events.manage",    label: "Manage events" },
  ]},
  { group: "Tasks",    perms: [
    { key: "tasks.assign",     label: "Assign tasks" },
    { key: "tasks.confirm",    label: "Confirm task completion" },
  ]},
  { group: "Points",   perms: [
    { key: "points.adjust",    label: "Adjust points ledger" },
  ]},
  { group: "Backwork", perms: [
    { key: "backwork.upload",  label: "Upload documents" },
    { key: "backwork.manage",  label: "Manage / delete documents" },
  ]},
  { group: "Programs", perms: [
    { key: "rush.manage",      label: "Manage recruitment" },
    { key: "onboarding.manage",label: "Manage onboarding" },
  ]},
  { group: "Finance",  perms: [
    { key: "billing.view",     label: "View billing" },
    { key: "billing.manage",   label: "Manage billing" },
  ]},
  { group: "Reports",  perms: [
    { key: "reports.view",     label: "View reports" },
  ]},
];

function SettingsRoles({ ctx }) {
  const { org } = ctx;
  const [tab, setTab] = useStateR("pack");
  const pack = window.ROLE_PACKS[org.rolePack] || [];

  return (
    <>
      <window.SettingsHead
        title="Roles"
        sub="Officer titles, what each can do, and any custom roles you've made for this chapter."
      />

      <div className="settings__tabs">
        <button className={`settings__tab ${tab === "pack" ? "settings__tab--active" : ""}`} onClick={() => setTab("pack")}>
          Role pack <span className="settings__tab-count">{pack.length}</span>
        </button>
        <button className={`settings__tab ${tab === "perms" ? "settings__tab--active" : ""}`} onClick={() => setTab("perms")}>
          Permission matrix
        </button>
        <button className={`settings__tab ${tab === "custom" ? "settings__tab--active" : ""}`} onClick={() => setTab("custom")}>
          Custom roles
        </button>
      </div>

      {tab === "pack"   && <RolePackPane org={org} pack={pack} />}
      {tab === "perms"  && <PermissionMatrix pack={pack} />}
      {tab === "custom" && <CustomRolesPane />}
    </>
  );
}

function RolePackPane({ org, pack }) {
  return (
    <div className="set-card">
      <div className="set-card__head">
        <span>{window.ORG_ARCHETYPES[org.archetype].label} pack</span>
        <span className="set-card__chip">{pack.length} roles</span>
      </div>
      <div className="set-card__body" style={{ padding: 0 }}>
        <table className="set-tbl">
          <thead>
            <tr>
              <th style={{ width: 50 }}>Rank</th>
              <th>Role</th>
              <th>Key</th>
              <th style={{ width: 110 }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {pack.map(r => (
              <tr key={r.key}>
                <td className="set-tbl__num">{String(r.rank).padStart(2, "0")}</td>
                <td><strong>{r.label}</strong></td>
                <td className="text-muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.key}</td>
                <td>{r.optional ? <span className="chip chip--quiet">Optional</span> : <span className="chip">Core</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PermissionMatrix({ pack }) {
  const roleKeys = ["president", "vp", "treasurer", "secretary", "member", "newmember"];
  return (
    <div className="set-card">
      <div className="set-card__head">Capability matrix</div>
      <div className="set-card__body" style={{ padding: 0, overflowX: "auto" }}>
        <table className="set-tbl set-tbl--matrix">
          <thead>
            <tr>
              <th>Capability</th>
              {roleKeys.map(k => <th key={k} style={{ textAlign: "center" }}>{window.ROLES[k]?.label.split(" ")[0] || k}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map(g => (
              <React.Fragment key={g.group}>
                <tr className="set-tbl__group">
                  <td colSpan={roleKeys.length + 1}>{g.group}</td>
                </tr>
                {g.perms.map(p => (
                  <tr key={p.key}>
                    <td>
                      <div>{p.label}</div>
                      <div className="text-muted" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.key}</div>
                    </td>
                    {roleKeys.map(rk => {
                      const has = window.hasCap(rk, p.key);
                      return (
                        <td key={rk} style={{ textAlign: "center" }}>
                          {has ? <span className="cap-dot cap-dot--on">●</span> : <span className="cap-dot">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="set-card__foot">
        <span className="text-muted text-sm">Read-only in beta — the matrix is editable by Frapp staff. <window.Proposed note="Per-org editable capability matrix" /></span>
      </div>
    </div>
  );
}

function CustomRolesPane() {
  return (
    <div className="set-card">
      <div className="set-card__head">Custom roles</div>
      <div className="set-card__body">
        <p className="text-muted" style={{ marginTop: 0 }}>
          Define roles that don't exist in your archetype's pack — Risk Manager, Philanthropy Chair, Brotherhood Chair, etc.
          Each custom role can pick its own permissions from the matrix above.
        </p>
        <div className="empty-rule">
          <div className="empty-rule__title">No custom roles yet</div>
          <div className="empty-rule__sub">Most chapters add 2-4 chair roles in their first month.</div>
          <button className="btn btn--primary" style={{ marginTop: 10 }}>
            {window.I.plus}<span>Add custom role</span>
          </button>
        </div>
      </div>
    </div>
  );
}

window.SettingsRoles = SettingsRoles;
