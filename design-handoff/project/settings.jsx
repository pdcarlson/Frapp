/* Settings — per-org customization hub.
   Reads/writes ctx.org. */

const { useState: useStateS } = React;

const SETTINGS_SECTIONS = [
  { key: "org",       label: "Organization",    icon: "users",    desc: "Identity, archetype, vocabulary" },
  { key: "modules",   label: "Modules",         icon: "grip",     desc: "What surfaces show up" },
  { key: "roles",     label: "Roles",           icon: "star",     desc: "Officer titles and permissions" },
  { key: "fields",    label: "Custom fields",   icon: "ledger",   desc: "Extra data on members" },
  { key: "workflows", label: "Workflows",       icon: "check",    desc: "Approvals, grace, enforcement" },
  { key: "dues",      label: "Dues structure",  icon: "card",     desc: "Cadence, amounts, plans" },
  { key: "beta",      label: "Beta program",    icon: "alert",    desc: "Build channel, feedback" },
  { key: "audit",     label: "Audit log",       icon: "clock",    desc: "Who changed what" },
];

function SettingsScreen({ ctx }) {
  const [section, setSection] = useStateS("modules");
  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display">Settings</h1>
      </div>
      <p className="text-muted" style={{ marginTop: -8, marginBottom: 24, maxWidth: 640 }}>
        Per-chapter configuration. Changes apply to everyone in {ctx.org.branding.chapterDesignation}.
        Some changes (archetype, role pack) are advised-by-nationals decisions — you'll see a confirmation before they take effect.
      </p>

      <div className="settings">
        <aside className="settings__rail">
          {SETTINGS_SECTIONS.map(s => (
            <button
              key={s.key}
              className={`settings__rail-item ${section === s.key ? "settings__rail-item--active" : ""}`}
              onClick={() => setSection(s.key)}
            >
              <span className="settings__rail-icon">{window.I[s.icon] || window.I.folder}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <div className="settings__rail-label">{s.label}</div>
                <div className="settings__rail-desc">{s.desc}</div>
              </span>
            </button>
          ))}
        </aside>

        <div className="settings__pane">
          {section === "org"       && <window.SettingsOrg       ctx={ctx} />}
          {section === "modules"   && <window.SettingsModules   ctx={ctx} />}
          {section === "roles"     && <window.SettingsRoles     ctx={ctx} />}
          {section === "fields"    && <window.SettingsFields    ctx={ctx} />}
          {section === "workflows" && <window.SettingsWorkflows ctx={ctx} />}
          {section === "dues"      && <window.SettingsDues      ctx={ctx} />}
          {section === "beta"      && <window.SettingsBeta      ctx={ctx} />}
          {section === "audit"     && <window.SettingsAudit     ctx={ctx} />}
        </div>
      </div>
    </>
  );
}

/* Shared bits for all settings panes. */
function SettingsHead({ title, sub }) {
  return (
    <div className="pane-head">
      <h2 className="pane-head__title">{title}</h2>
      {sub && <p className="pane-head__sub">{sub}</p>}
    </div>
  );
}

function SetField({ label, hint, children }) {
  return (
    <div className="set-field">
      <label className="set-field__label">{label}</label>
      {hint && <div className="set-field__hint">{hint}</div>}
      {children}
    </div>
  );
}

function SetRow({ label, hint, children, action }) {
  return (
    <div className="set-row">
      <div className="set-row__txt">
        <div className="set-row__label">{label}</div>
        {hint && <div className="set-row__hint">{hint}</div>}
      </div>
      <div className="set-row__ctrl">{children}</div>
      {action && <div className="set-row__action">{action}</div>}
    </div>
  );
}

Object.assign(window, { SettingsScreen, SettingsHead, SetField, SetRow });
